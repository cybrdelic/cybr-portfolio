"""Execute the actual display fragment with the local GLES driver."""
from pathlib import Path
import importlib.util,json
import glfw,numpy as np
from OpenGL import GL
root=Path(__file__).resolve().parents[2];folder=root/'portfolio/output/elements-bake/hdr-proof'
spec=importlib.util.spec_from_file_location('qa',root/'cybr-elements/tools/fire-studio/original-volume-qa.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
assert glfw.init();glfw.window_hint(glfw.VISIBLE,glfw.FALSE);glfw.window_hint(glfw.CLIENT_API,glfw.OPENGL_ES_API)
glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR,3);glfw.window_hint(glfw.CONTEXT_VERSION_MINOR,0)
window=glfw.create_window(8,8,'HDR proof',None,None);assert window
try:
 glfw.make_context_current(window);GL.glBindVertexArray(GL.glGenVertexArrays(1))
 vertex='#version 300 es\nprecision highp float;out vec2 screenUV;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));screenUV=p;gl_Position=vec4(p*2.-1.,0,1);}'
 program=GL.glCreateProgram();GL.glAttachShader(program,qa.shader(GL.GL_VERTEX_SHADER,vertex));GL.glAttachShader(program,qa.shader(GL.GL_FRAGMENT_SHADER,(folder/'fragment.glsl').read_text()));GL.glLinkProgram(program)
 assert GL.glGetProgramiv(program,GL.GL_LINK_STATUS),GL.glGetProgramInfoLog(program)
 GL.glUseProgram(program);GL.glUniform1f(GL.glGetUniformLocation(program,'toneMappingExposure'),1.)
 texture=GL.glGenTextures(1);GL.glActiveTexture(GL.GL_TEXTURE0);GL.glBindTexture(GL.GL_TEXTURE_2D,texture)
 GL.glTexParameteri(GL.GL_TEXTURE_2D,GL.GL_TEXTURE_MIN_FILTER,GL.GL_NEAREST);GL.glTexParameteri(GL.GL_TEXTURE_2D,GL.GL_TEXTURE_MAG_FILTER,GL.GL_NEAREST)
 GL.glUniform1i(GL.glGetUniformLocation(program,'source'),0);GL.glViewport(0,0,8,8)
 proof=[]
 for sample in json.loads((folder/'samples.json').read_text()):
  GL.glTexImage2D(GL.GL_TEXTURE_2D,0,GL.GL_RGBA16F,1,1,0,GL.GL_RGBA,GL.GL_FLOAT,np.array([[sample['rgb']+[1.]]],np.float32))
  GL.glDrawArrays(GL.GL_TRIANGLES,0,3);GL.glFinish();pixel=list(GL.glReadPixels(4,4,1,1,GL.GL_RGBA,GL.GL_UNSIGNED_BYTE))[:3]
  error=max(abs(a-b) for a,b in zip(pixel,sample['expected']));proof.append(dict(**sample,actual=pixel,maxError=error))
 report=dict(pass_=all(p['maxError']<=1 for p in proof),gpu=GL.glGetString(GL.GL_RENDERER).decode(),glError=int(GL.glGetError()),samples=proof)
 (folder/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='samples'}));assert report['pass_'] and report['glError']==0
finally:glfw.destroy_window(window);glfw.terminate()
