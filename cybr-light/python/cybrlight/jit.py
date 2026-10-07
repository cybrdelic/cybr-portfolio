"""Independent expression graph, reverse AD, and native C++ kernel compiler.

Uses NumPy and a system C++ compiler. Graphs are elementwise/broadcast
expressions; reduction, dynamic control flow and GPU lowering are not claimed.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import numpy as np

@dataclass(frozen=True)
class Node:
    op: str
    inputs: tuple[int,...]=()
    value: float=0.0
    name: str=''

class Expr:
    __array_priority__=1000
    def __init__(self,graph,index): self.graph=graph;self.index=index
    def _op(self,name,*others):
        args=[self]+[self.graph.constant(v) if not isinstance(v,Expr) else v for v in others]
        if any(a.graph is not self.graph for a in args):raise ValueError("Expressions belong to different graphs")
        return self.graph._add(Node(name,tuple(a.index for a in args)))
    def __add__(self,v):return self._op('add',v)
    def __radd__(self,v):return self+v
    def __sub__(self,v):return self._op('sub',v)
    def __rsub__(self,v):return self.graph.constant(v)-self
    def __mul__(self,v):return self._op('mul',v)
    def __rmul__(self,v):return self*v
    def __truediv__(self,v):return self._op('div',v)
    def __rtruediv__(self,v):return self.graph.constant(v)/self
    def __neg__(self):return self*-1
    def __pow__(self,v):return self._op('pow',v)
    def exp(self):return self._op('exp')
    def log(self):return self._op('log')
    def sqrt(self):return self._op('sqrt')
    def sin(self):return self._op('sin')
    def cos(self):return self._op('cos')
    def tanh(self):return self._op('tanh')
    def sigmoid(self):return self._op('sigmoid')
    def greater(self,v):return self._op('gt',v)
    def less(self,v):return self._op('lt',v)
    def greater_equal(self,v):return self._op('ge',v)
    def less_equal(self,v):return self._op('le',v)
    def select(self,yes,no):return self._op('select',yes,no)
    def __bool__(self):raise TypeError('Graph expressions are not Python booleans; use select()')
    def abs(self):return self._op('abs')
    def maximum(self,v):return self._op('max',v)
    def minimum(self,v):return self._op('min',v)

class Graph:
    def __init__(self):self.nodes=[];self.inputs={};self._constants={}
    def _add(self,node):self.nodes.append(node);return Expr(self,len(self.nodes)-1)
    def input(self,name):
        if not isinstance(name,str) or not name.isidentifier():raise ValueError("Input names must be identifiers")
        if name in self.inputs:return Expr(self,self.inputs[name])
        expr=self._add(Node('input',name=name));self.inputs[name]=expr.index;return expr
    def constant(self,value):
        if isinstance(value,Expr):
            if value.graph is not self:raise ValueError("Graph mismatch")
            return value
        value=float(value)
        if not np.isfinite(value):raise ValueError("Nonfinite graph constant")
        if value not in self._constants:self._constants[value]=self._add(Node('const',value=value)).index
        return Expr(self,self._constants[value])
    def reachable(self,output):
        if output.graph is not self:raise ValueError("Graph mismatch")
        active=set();pending=[output.index]
        while pending:
            i=pending.pop()
            if i in active:continue
            active.add(i);pending.extend(self.nodes[i].inputs)
        return active
    def _values(self,values,output=None):
        missing=set(self.inputs)-set(values)
        if missing:raise ValueError(f"Missing graph inputs: {sorted(missing)}")
        result=[]
        active=self.reachable(output) if output is not None else set(range(len(self.nodes)))
        with np.errstate(over='raise',divide='raise',invalid='raise',under='ignore'):
            for index,n in enumerate(self.nodes):
                if index not in active:result.append(None);continue
                a=[result[i] for i in n.inputs]
                if n.op=='input':v=np.asarray(values[n.name],dtype=float)
                elif n.op=='const':v=np.asarray(n.value)
                elif n.op=='add':v=a[0]+a[1]
                elif n.op=='sub':v=a[0]-a[1]
                elif n.op=='mul':v=a[0]*a[1]
                elif n.op=='div':v=a[0]/a[1]
                elif n.op=='pow':v=a[0]**a[1]
                elif n.op=='max':v=np.maximum(a[0],a[1])
                elif n.op=='min':v=np.minimum(a[0],a[1])
                elif n.op in ('gt','lt','ge','le'):v=getattr(np,{'gt':'greater','lt':'less','ge':'greater_equal','le':'less_equal'}[n.op])(a[0],a[1]).astype(float)
                elif n.op=='select':v=np.where(a[0]!=0,a[1],a[2])
                elif n.op=='sigmoid':
                    e=np.exp(-np.abs(a[0]));v=np.where(a[0]>=0,1/(1+e),e/(1+e))
                else:v=getattr(np,{'abs':'abs'}.get(n.op,n.op))(a[0])
                result.append(v)
        return result
    def evaluate(self,output,**inputs):return self._values(inputs,output)[output.index]
    def backward(self,output,inputs,seed=None):
        v=self._values(inputs,output);g=[None]*len(v);g[output.index]=np.ones_like(v[output.index]) if seed is None else np.asarray(seed,dtype=float)
        def reduce(value,shape):
            while value.ndim>len(shape):value=value.sum(axis=0)
            for axis,n in enumerate(shape):
                if n==1 and value.shape[axis]!=1:value=value.sum(axis=axis,keepdims=True)
            return value
        for i in range(len(v)-1,-1,-1):
            if g[i] is None:continue
            n=self.nodes[i];a=[v[j] for j in n.inputs];partials=[]
            if n.op=='add':partials=[1,1]
            elif n.op=='sub':partials=[1,-1]
            elif n.op=='mul':partials=[a[1],a[0]]
            elif n.op=='div':partials=[1/a[1],-a[0]/a[1]**2]
            elif n.op=='pow':
                partials=[a[1]*a[0]**(a[1]-1),v[i]*np.log(np.maximum(a[0],1e-300))]
            elif n.op=='exp':partials=[v[i]]
            elif n.op=='log':partials=[1/a[0]]
            elif n.op=='sqrt':partials=[.5/v[i]]
            elif n.op=='sin':partials=[np.cos(a[0])]
            elif n.op=='cos':partials=[-np.sin(a[0])]
            elif n.op=='tanh':partials=[1-v[i]**2]
            elif n.op=='sigmoid':partials=[v[i]*(1-v[i])]
            elif n.op in ('gt','lt','ge','le'):partials=[0,0]
            elif n.op=='select':partials=[0,a[0]!=0,a[0]==0]
            elif n.op=='abs':partials=[np.sign(a[0])]
            elif n.op in ('max','min'):
                mask=a[0]>=a[1] if n.op=='max' else a[0]<=a[1];partials=[mask,~mask]
            for j,d in zip(n.inputs,partials):
                value=reduce(g[i]*d,v[j].shape);g[j]=value if g[j] is None else g[j]+value
        return {name:np.zeros_like(np.asarray(inputs[name],dtype=float)) if g[i] is None else g[i] for name,i in self.inputs.items()}
    def gradient(self,output,wrt):
        """Symbolic reverse differentiation; the result can be differentiated again.

        This differentiates an elementwise graph, not scene visibility. At abs/
        max/min boundaries it uses the same documented branch choice as backward.
        """
        if isinstance(wrt,str):wrt=Expr(self,self.inputs[wrt])
        if output.graph is not self or wrt.graph is not self:raise ValueError("Graph mismatch")
        original=list(self.nodes);active=self.reachable(output);adj={output.index:self.constant(1)}
        for i in range(len(original)-1,-1,-1):
            if i not in active or i not in adj:continue
            n=original[i];a=[Expr(self,j) for j in n.inputs];y=Expr(self,i);partials=[]
            if n.op=='add':partials=[1,1]
            elif n.op=='sub':partials=[1,-1]
            elif n.op=='mul':partials=[a[1],a[0]]
            elif n.op=='div':partials=[1/a[1],-a[0]/a[1]**2]
            elif n.op=='pow':partials=[a[1]*a[0]**(a[1]-1),0 if original[n.inputs[1]].op=='const' else y*a[0].log()]
            elif n.op=='exp':partials=[y]
            elif n.op=='log':partials=[1/a[0]]
            elif n.op=='sqrt':partials=[.5/y]
            elif n.op=='sin':partials=[a[0].cos()]
            elif n.op=='cos':partials=[-a[0].sin()]
            elif n.op=='tanh':partials=[1-y*y]
            elif n.op=='sigmoid':partials=[y*(1-y)]
            elif n.op=='abs':partials=[a[0].greater(0)-a[0].less(0)]
            elif n.op in ('gt','lt','ge','le'):partials=[0,0]
            elif n.op=='select':
                mask=a[0].abs().greater(0);partials=[0,mask,1-mask]
            elif n.op in ('min','max'):
                mask=a[0].greater_equal(a[1]) if n.op=='max' else a[0].less_equal(a[1]);partials=[mask,1-mask]
            for j,partial in zip(n.inputs,partials):
                if original[j].op=='const':continue
                value=adj[i]*partial;adj[j]=value if j not in adj else adj[j]+value
        return adj.get(wrt.index,self.constant(0))
    def _cpp(self,output,shader=False):
        names=list(self.inputs);N=len(self.nodes);active=self.reachable(output);lines=['#include <cmath>','#include <cstddef>','#include <algorithm>',
          'static double cybr_sigmoid(double x){double e=std::exp(-std::abs(x));return x>=0?1/(1+e):e/(1+e);}',
          'static void evaluate(const double* in,double* out,double* grad){',f' double g[{N}]={{0}};']
        for i,n in enumerate(self.nodes):
            if i not in active:continue
            a=[f'v{j}' for j in n.inputs]
            if n.op=='input':expr=f'in[{names.index(n.name)}]'
            elif n.op=='const':expr=format(n.value,'.17g')
            elif n.op in ('add','sub','mul','div'):expr=f'({a[0]} { {"add":"+","sub":"-","mul":"*","div":"/"}[n.op] } {a[1]})'
            elif n.op in ('gt','lt','ge','le'):expr=f'({a[0]}'+{'gt':'>','lt':'<','ge':'>=','le':'<='}[n.op]+f'{a[1]})'
            elif n.op=='select':expr=f'({a[0]}!=0?{a[1]}:{a[2]})'
            elif n.op=='sigmoid':expr=f'cybr_sigmoid({a[0]})'
            elif n.op in ('max','min','pow'):expr=f'std::{n.op}({a[0]},{a[1]})'
            else:expr=f'std::{"abs" if n.op=="abs" else n.op}({a[0]})'
            lines.append(f' const double v{i}={expr};')
        lines.append(f' *out=v{output.index};g[{output.index}]=1;')
        for i in range(N-1,-1,-1):
            if i not in active:continue
            n=self.nodes[i];a=[f'v{j}' for j in n.inputs];d=[]
            if n.op=='add':d=['1','1']
            elif n.op=='sub':d=['1','-1']
            elif n.op=='mul':d=[a[1],a[0]]
            elif n.op=='div':d=[f'(1/{a[1]})',f'(-{a[0]}/({a[1]}*{a[1]}))']
            elif n.op=='pow':d=[f'({a[1]}*std::pow({a[0]},{a[1]}-1))',f'(v{i}*std::log(std::max(1e-300,{a[0]})))']
            elif n.op=='exp':d=[f'v{i}']
            elif n.op=='log':d=[f'(1/{a[0]})']
            elif n.op=='sqrt':d=[f'(.5/v{i})']
            elif n.op=='sin':d=[f'std::cos({a[0]})']
            elif n.op=='cos':d=[f'(-std::sin({a[0]}))']
            elif n.op=='tanh':d=[f'(1-v{i}*v{i})']
            elif n.op=='sigmoid':d=[f'(v{i}*(1-v{i}))']
            elif n.op in ('gt','lt','ge','le'):d=['0','0']
            elif n.op=='select':d=['0',f'({a[0]}!=0?1:0)',f'({a[0]}==0?1:0)']
            elif n.op=='abs':d=[f'({a[0]}>0?1:({a[0]}<0?-1:0))']
            elif n.op in ('max','min'):
                cond=f'{a[0]}' + ('>=' if n.op=='max' else '<=') + a[1];d=[f'({cond}?1:0)',f'({cond}?0:1)']
            for j,derivative in zip(n.inputs,d):lines.append(f' g[{j}]+=g[{i}]*{derivative};')
        for k,name in enumerate(names):lines.append(f' grad[{k}]=g[{self.inputs[name]}];')
        lines += ['}',f'extern "C" void cybr_kernel(size_t n,const double* in,double* out,double* grad){{for(size_t i=0;i<n;i++)evaluate(in+i*{len(names)},out+i,grad+i*{len(names)});}}']
        if shader:
            if set(names)-{'nm','u','v','p0','p1','p2'}:raise ValueError("Native material shader inputs must be nm,u,v,p0,p1,p2")
            expressions={'nm':'nm','u':'u','v':'v','p0':'p[0]','p1':'p[1]','p2':'p[2]'}
            lines.append(f'extern "C" void cybr_shader(double nm,double u,double v,const double*p,double*out,double*gradient){{double in[{len(names)}]={{{",".join(expressions[k] for k in names)}}};double g[{len(names)}];evaluate(in,out,g);')
            for i in range(3):lines.append(f' gradient[{i}]='+ (f'g[{names.index("p"+str(i))}]' if 'p'+str(i) in names else '0')+';')
            lines.append('}')
        return '\n'.join(lines)+'\n'
    def save(self,output,path,*,shader=False):
        if output.graph is not self:raise ValueError('Graph mismatch')
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({'format':'cybr-expression-1','nodes':[n.__dict__ for n in self.nodes],
                                   'inputs':list(self.inputs),'output':output.index,'shader':bool(shader)},indent=2,allow_nan=False))
        return path
    @classmethod
    def load(cls,path):
        path=Path(path)
        if path.stat().st_size>64_000_000:raise ValueError('Expression graph file is too large')
        data=json.loads(path.read_text());nodes=data.get('nodes',[])
        if data.get('format','cybr-expression-1')!='cybr-expression-1' or not nodes or len(nodes)>100_000:raise ValueError('Unsupported or excessive expression graph')
        counts={'input':0,'const':0,'add':2,'sub':2,'mul':2,'div':2,'pow':2,'max':2,'min':2,
                'gt':2,'lt':2,'ge':2,'le':2,'select':3,'exp':1,'log':1,'sqrt':1,'sin':1,'cos':1,'tanh':1,'sigmoid':1,'abs':1}
        graph=cls()
        for i,record in enumerate(nodes):
            if set(record)-{'op','inputs','value','name'}:raise ValueError('Unknown expression node field')
            op=record.get('op');arguments=tuple(record.get('inputs',()))
            if op not in counts or len(arguments)!=counts[op] or any(not isinstance(j,int) or not 0<=j<i for j in arguments):raise ValueError('Invalid expression operation or non-topological graph')
            value=float(record.get('value',0));name=record.get('name','')
            if not np.isfinite(value):raise ValueError('Nonfinite graph value')
            if op=='input':
                if not isinstance(name,str) or not name.isidentifier() or name in graph.inputs:raise ValueError('Invalid or duplicate graph input')
                graph.inputs[name]=i
            graph.nodes.append(Node(op,arguments,value,name))
            if op=='const':graph._constants[value]=i
        output=data.get('output')
        if not isinstance(output,int) or not 0<=output<len(nodes) or list(graph.inputs)!=data.get('inputs'):raise ValueError('Invalid graph output/input ordering')
        return graph,Expr(graph,output)

    def compile(self,output,directory=None,*,shader=False):
        if output.graph is not self:raise ValueError("Graph mismatch")
        compiler=shutil.which(os.environ.get('CXX','c++'))
        if not compiler:raise RuntimeError("A C++17 compiler is required for native kernel compilation")
        if not self.inputs:raise ValueError('Compiled kernels require at least one named input; eager evaluation supports constants')
        source=self._cpp(output,shader);digest=hashlib.sha256(source.encode()).hexdigest();root=Path(directory or Path.home()/'.cache'/'cybrlight'/'jit')/digest[:20];root.mkdir(parents=True,exist_ok=True)
        cpp=root/'kernel.cpp';cpp.write_text(source);library=root/('kernel.dylib' if sys.platform=='darwin' else 'kernel.so')
        command=[compiler,'-std=c++17','-O3','-shared','-fPIC',str(cpp),'-o',str(library)]
        result=subprocess.run(command,capture_output=True,text=True)
        (root/'compile.json').write_text(json.dumps({'command':command,'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'sha256':digest,'backend':'independent generated C++ CPU kernel'},indent=2))
        if result.returncode:raise RuntimeError(f"Kernel compilation failed: {result.stderr}")
        self.save(output,root/'graph.json',shader=shader)
        return CompiledKernel(library,list(self.inputs))

class CompiledKernel:
    def __init__(self,path,inputs):
        self.path=Path(path).resolve();self.inputs=list(inputs);self.library=ctypes.CDLL(str(self.path));self.call=self.library.cybr_kernel
        pointer=ctypes.POINTER(ctypes.c_double);self.call.argtypes=[ctypes.c_size_t,pointer,pointer,pointer];self.call.restype=None
    def __call__(self,**inputs):
        if set(inputs)!=set(self.inputs):raise ValueError("Compiled kernel input names do not match")
        arrays=np.broadcast_arrays(*[np.asarray(inputs[k],dtype=np.float64) for k in self.inputs]);shape=arrays[0].shape
        packed=np.ascontiguousarray(np.stack(arrays,axis=-1).reshape(-1,len(self.inputs)));out=np.empty(len(packed));grad=np.empty_like(packed)
        pointer=ctypes.POINTER(ctypes.c_double);self.call(len(out),packed.ctypes.data_as(pointer),out.ctypes.data_as(pointer),grad.ctypes.data_as(pointer))
        if not np.isfinite(out).all() or not np.isfinite(grad).all():raise FloatingPointError("Compiled kernel produced nonfinite values or derivatives")
        return out.reshape(shape),{k:grad[:,i].reshape(shape) for i,k in enumerate(self.inputs)}
