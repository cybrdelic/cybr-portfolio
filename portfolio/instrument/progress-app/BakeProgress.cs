using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Globalization;
using System.Linq;
using System.Management;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class BakeState {
    public int Total, Completed, Current=-1;
    public string Phase="Unavailable", Error="", Detail="", LatestImage="";
    public bool Alive, Native, Gpu;
    public int Packets, TotalPackets;
    public double Memory, Cpu, Median;
    public string GpuName="", GpuTelemetry="GPU telemetry unavailable";
    public double? GpuUtilization, VramUsedMiB, VramTotalMiB;
    public DateTime Started, Updated, ReadAt;
    public List<int> Finished=new List<int>();
    static string ReadShared(string path) {
        using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
        using(var reader=new StreamReader(stream))return reader.ReadToEnd();
    }
    public static BakeState Read(string build) {
        var s=new BakeState();s.ReadAt=DateTime.Now;
        try {
            var json=new JavaScriptSerializer();string folder=Path.Combine(build,"path-bake-light");
            var d=json.Deserialize<Dictionary<string,object>>(ReadShared(Path.Combine(folder,"job-status.json")));
            s.Total=Convert.ToInt32(d["expected"]);s.Completed=Convert.ToInt32(d["completed"]);
            s.Phase=Convert.ToString(d["phase"]);s.Current=d["checkpoint"]==null?-1:Convert.ToInt32(d["checkpoint"]);
            s.Gpu=d.ContainsKey("backend") && Convert.ToString(d["backend"])=="optix";
            if(s.Gpu && s.Current>=0) {
                string sampleFile=Path.Combine(folder,s.Current.ToString("D3"),"native-progress.json");
                if(File.Exists(sampleFile))try {
                    var samples=json.Deserialize<Dictionary<string,object>>(ReadShared(sampleFile));
                    s.Packets=Convert.ToInt32(samples["completedPackets"]);s.TotalPackets=Convert.ToInt32(samples["totalPackets"]);
                } catch(IOException) {} catch(ArgumentException) {}
            }
            s.Started=DateTime.Parse(Convert.ToString(d["started"])).ToLocalTime();
            s.Updated=DateTime.Parse(Convert.ToString(d["updated"])).ToLocalTime();
            try {using(var p=Process.GetProcessById(Convert.ToInt32(d["pid"])))
                s.Alive=!p.HasExited && Math.Abs((p.StartTime-s.Started).TotalSeconds)<120;
            } catch(ArgumentException) {} catch(System.ComponentModel.Win32Exception) {}
            var times=new List<double>();DateTime latest=DateTime.MinValue;
            for(int i=0;i<s.Total;i++) {
                string frame=Path.Combine(folder,i.ToString("D3")),receipt=Path.Combine(frame,"receipt.json");
                if(!File.Exists(receipt))continue;
                try {
                    var r=json.Deserialize<Dictionary<string,object>>(ReadShared(receipt));
                    if(!Convert.ToBoolean(r["complete"])||!Convert.ToString(r["renderer"]).StartsWith("CYBR LIGHT"))continue;
                    s.Finished.Add(i);
                    if(!s.Gpu || Convert.ToString(r["renderer"]).Contains("OptiX"))times.Add(Convert.ToDouble(r["seconds"]));
                    if(File.GetLastWriteTime(receipt)>latest && File.Exists(Path.Combine(frame,"beauty.png"))) {
                        latest=File.GetLastWriteTime(receipt);s.LatestImage=Path.Combine(frame,"beauty.png");
                    }
                } catch(IOException) {} catch(ArgumentException) {}
            }
            times.Sort();if(times.Count>0)s.Median=times[times.Count/2];
            // Query process ancestry, rather than attributing another render's
            // CPU usage to this job. Failure to read WMI is not a bake failure.
            try {
                var parents=new Dictionary<int,int>();var names=new Dictionary<int,string>();
                var options=new EnumerationOptions { Timeout=TimeSpan.FromSeconds(2) };
                using(var query=new ManagementObjectSearcher("root\\CIMV2","SELECT ProcessId,ParentProcessId,Name FROM Win32_Process WHERE Name='python.exe' OR Name='cybr-light.exe' OR Name='cybr-light-optix.exe' OR Name='oidnDenoise.exe'",options))
                using(var results=query.Get())foreach(ManagementObject p in results)using(p) {
                    int id=Convert.ToInt32(p["ProcessId"]);parents[id]=Convert.ToInt32(p["ParentProcessId"]);names[id]=Convert.ToString(p["Name"]);
                }
                int root=Convert.ToInt32(d["pid"]);
                foreach(var entry in names.Where(x=>x.Value.Equals(s.Gpu?"cybr-light-optix.exe":"cybr-light.exe",StringComparison.OrdinalIgnoreCase))) {
                    int ancestor=entry.Key;var visited=new HashSet<int>();
                    while(parents.ContainsKey(ancestor)&&visited.Add(ancestor)&&ancestor!=root)ancestor=parents[ancestor];
                    if(ancestor!=root||!s.Alive)continue;
                    using(var p=Process.GetProcessById(entry.Key)) {
                        s.Native=true;s.Memory+=p.WorkingSet64/1073741824.0;s.Cpu+=p.TotalProcessorTime.TotalSeconds;
                    }
                }
            } catch(Exception) { s.Detail="Process telemetry unavailable; reading bake files."; }
            if(d.ContainsKey("error"))s.Error=Convert.ToString(d["error"]);
            if(s.Phase=="failed" && s.Error=="")s.Error="Bake stopped. Open the worker log for details.";
        } catch(Exception e) {s.Error=e.Message;}
        // Device-wide NVIDIA counters, not inferred from sample progress or CPU time.
        // Query off the UI thread and bound the lifetime of our own helper process.
        try {
            using(var helper=new Process()) {
                helper.StartInfo=new ProcessStartInfo("nvidia-smi.exe","--id=0 --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits") {
                    UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true
                };
                helper.Start();var output=helper.StandardOutput.ReadToEndAsync();var errors=helper.StandardError.ReadToEndAsync();
                if(!helper.WaitForExit(1500)) {
                    helper.Kill();s.GpuTelemetry="GPU telemetry unavailable (query timed out)";
                } else if(helper.ExitCode==0) {
                    var fields=output.GetAwaiter().GetResult().Trim().Split(',');double value;
                    if(fields.Length==4) {
                        s.GpuName=fields[0].Trim();s.GpuTelemetry=s.GpuName;
                        if(double.TryParse(fields[1].Trim(),NumberStyles.Float,CultureInfo.InvariantCulture,out value)&&value>=0&&value<=100)s.GpuUtilization=value;
                        if(double.TryParse(fields[2].Trim(),NumberStyles.Float,CultureInfo.InvariantCulture,out value)&&value>=0)s.VramUsedMiB=value;
                        if(double.TryParse(fields[3].Trim(),NumberStyles.Float,CultureInfo.InvariantCulture,out value)&&value>0)s.VramTotalMiB=value;
                    }
                }
            }
        } catch(Exception) { s.GpuTelemetry="GPU telemetry unavailable (NVIDIA query failed)"; }
        return s;
    }
}

sealed class ProgressCanvas:Control {
    public BakeState State=new BakeState();public int Pulse;
    static readonly Color Accent=Color.FromArgb(182,38,36);
    public ProgressCanvas(){DoubleBuffered=true;}
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);var g=e.Graphics;int width=ClientSize.Width;
        using(var light=new SolidBrush(Color.FromArgb(214,214,208)))g.FillRectangle(light,0,0,width,12);
        using(var red=new SolidBrush(Accent))g.FillRectangle(red,0,0,State.Total>0?width*Math.Min(State.Completed,State.Total)/State.Total:0,12);
        using(var font=new Font("Consolas",9))using(var ink=new SolidBrush(Color.FromArgb(40,40,40)))
        using(var done=new SolidBrush(Accent))using(var waiting=new SolidBrush(Color.FromArgb(221,221,215))) {
            for(int i=0;i<State.Total;i++) {
                int x=(i%7)*43,y=32+(i/7)*30;bool complete=State.Finished.Contains(i);
                g.FillRectangle(complete?done:waiting,x,y,37,24);
                if(i==State.Current && State.Alive && !complete)using(var pen=new Pen(Accent,2))g.DrawRectangle(pen,x+1,y+1,35,22);
                g.DrawString(i.ToString("D2"),font,complete?Brushes.White:ink,x+9,y+5);
            }
        }
        if(State.Alive && State.Phase!="complete" && State.Phase!="failed") {
            using(var red=new SolidBrush(Accent)) {
                if(State.Gpu && State.TotalPackets>0)g.FillRectangle(red,0,258,width*Math.Min(State.Packets,State.TotalPackets)/State.TotalPackets,4);
                else g.FillRectangle(red,(Pulse%Math.Max(1,width-60)),258,60,3);
            }
        }
    }
}

sealed class BakeWindow:Form {
    readonly string build;readonly Timer poll=new Timer(),animation=new Timer();
    readonly Label count,phase,details,footer,previewTitle,gpuDetails;
    readonly ProgressCanvas progress;readonly PictureBox preview;
    bool busy;string lastImage="";double lastCpu=-1;DateTime lastRead;BakeState state=new BakeState();
    public BakeWindow(string folder) {
        build=folder;Text="CYBR LIGHT — Bake progress";ClientSize=new Size(850,660);
        FormBorderStyle=FormBorderStyle.FixedSingle;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(239,239,233);ForeColor=Color.FromArgb(30,30,30);Font=new Font("Segoe UI",10);
        AutoScaleMode=AutoScaleMode.Dpi;
        AddLabel("CYBR / LIGHT",26,22,450,32,21);
        AddLabel("NATIVE SPECTRAL BAKE   /   LIVE MONITOR",28,62,700,24,10);
        count=AddLabel("Connecting…",26,99,350,53,30);
        phase=AddLabel("Reading the existing render job",29,162,780,28,13);
        progress=new ProgressCanvas {Location=new Point(30,208),Size=new Size(298,266)};Controls.Add(progress);
        previewTitle=AddLabel("LATEST COMPLETED VIEW",367,207,440,23,10);
        preview=new PictureBox {Location=new Point(367,236),Size=new Size(452,237),SizeMode=PictureBoxSizeMode.Zoom,BackColor=Color.FromArgb(226,226,220)};Controls.Add(preview);
        gpuDetails=AddLabel("Reading GPU utilization…",29,485,790,48,10);
        details=AddLabel("",29,541,790,50,10);
        Button("Open gallery",29,604,delegate {Open("http://127.0.0.1:4173/portfolio/instrument/light-bakes.html?revision=2");});
        Button("Open bake folder",170,604,delegate {Open(Path.Combine(build,"path-bake-light"));});
        Button("Worker log",331,604,delegate {
            if(state.Current>=0)Open(Path.Combine(build,"logs",(state.Gpu?"optix-path-":"cybr-light-path-")+state.Current.ToString("D3")+".log"));
        });
        var top=new CheckBox {Text="Always on top",Location=new Point(650,611),AutoSize=true};top.CheckedChanged+=delegate{TopMost=top.Checked;};Controls.Add(top);
        footer=AddLabel("",29,638,790,19,8);
        poll.Interval=3000;poll.Tick+=delegate{RefreshState();};
        animation.Interval=40;animation.Tick+=delegate{progress.Pulse+=5;progress.Invalidate();};
        Shown+=delegate{RefreshState();poll.Start();};
        FormClosed+=delegate{poll.Dispose();animation.Dispose();if(preview.Image!=null)preview.Image.Dispose();};
    }
    Label AddLabel(string text,int x,int y,int w,int h,int size) {
        var label=new Label{Text=text,Location=new Point(x,y),Size=new Size(w,h),Font=new Font("Segoe UI",size)};Controls.Add(label);return label;
    }
    void Button(string text,int x,int y,Action click) {
        var b=new Button{Text=text,Location=new Point(x,y),Size=new Size(135,30),FlatStyle=FlatStyle.Flat};b.Click+=delegate{click();};Controls.Add(b);
    }
    void Open(string target){try{Process.Start(new ProcessStartInfo(target){UseShellExecute=true});}catch(Exception e){MessageBox.Show(this,e.Message,"Cannot open");}}
    static string Duration(double seconds){var t=TimeSpan.FromSeconds(Math.Max(0,seconds));return t.TotalHours>=1?((int)t.TotalHours)+"h "+t.Minutes+"m":((int)t.TotalMinutes)+"m "+t.Seconds+"s";}
    async void RefreshState() {
        if(busy)return;busy=true;
        try {
            var next=await Task.Run(()=>BakeState.Read(build));if(IsDisposed)return;
            state=next;progress.State=state;
            gpuDetails.Text=state.GpuTelemetry+"\nGPU usage "+(state.GpuUtilization.HasValue?state.GpuUtilization.Value.ToString("0")+"%":"unavailable")+
                "  ·  VRAM "+(state.VramUsedMiB.HasValue&&state.VramTotalMiB.HasValue?(state.VramUsedMiB.Value/1024).ToString("0.00")+" / "+(state.VramTotalMiB.Value/1024).ToString("0.00")+" GiB":"unavailable")+"  ·  Whole device (all apps)";
            double percent=state.Total>0?100.0*state.Completed/state.Total:0;
            count.Text=state.Completed+" / "+state.Total+"   ·   "+percent.ToString("0.0")+"%";
            string activity=state.Phase=="complete"?"BAKE COMPLETE — visual verification still required":
                state.Phase=="failed"?"BAKE FAILED":!state.Alive?"JOB NOT RUNNING — last saved progress":
                state.Native?(state.Gpu?"GPU RENDERING":"CPU RENDERING"):"WORKING / "+state.Phase.ToUpperInvariant();
            phase.Text=activity+(state.Current>=0?"   ·   View "+state.Current.ToString("D2"):"");
            bool active=state.Alive && state.Phase!="complete" && state.Phase!="failed";
            if(active)animation.Start();else animation.Stop();progress.Invalidate();
            string cpu="";
            if(state.Native && lastCpu>=0 && state.Cpu>=lastCpu && (state.ReadAt-lastRead).TotalSeconds>0)
                cpu="  ·  CPU "+Math.Min(100,100*(state.Cpu-lastCpu)/(state.ReadAt-lastRead).TotalSeconds/Environment.ProcessorCount).ToString("0")+"% of machine";
            lastCpu=state.Native?state.Cpu:-1;lastRead=state.ReadAt;
            string eta=state.Median>0&&active?"Approx. "+Duration(state.Median*Math.Max(0,state.Total-state.Completed))+" remaining ("+(state.Gpu?"GPU ":"")+"completed-view median; varies)":state.Gpu&&active?"GPU time estimate calibrating; previous CPU timings are not used.":"";
            details.Text=state.Error!=""?state.Error:
                (active?(state.Gpu&&state.TotalPackets>0?"Samples "+state.Packets+"/"+state.TotalPackets+" ("+(100.0*state.Packets/state.TotalPackets).ToString("0")+"%)":"Current stage: "+Duration((DateTime.Now-state.Updated).TotalSeconds))+"  ·  ":"")+
                (state.Native?"Renderer RAM "+state.Memory.ToString("0.00")+" GB"+cpu:state.Detail)+"\n"+eta;
            footer.Text="Checked "+state.ReadAt.ToString("HH:mm:ss")+"  ·  Refresh 3s  ·  "+(state.Gpu?"Measured GPU sample progress":"CPU frame % unavailable")+"  ·  Closing this app does not stop the bake";
            if(state.LatestImage!="" && state.LatestImage!=lastImage) {
                using(var stream=new FileStream(state.LatestImage,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
                using(var image=Image.FromStream(stream)) {
                    var copy=new Bitmap(image);var old=preview.Image;preview.Image=copy;if(old!=null)old.Dispose();
                }
                lastImage=state.LatestImage;previewTitle.Text="LATEST COMPLETED / VIEW "+new DirectoryInfo(Path.GetDirectoryName(lastImage)).Name;
            }
        } catch(Exception e){if(!IsDisposed)phase.Text="MONITOR ERROR · "+e.Message;}
        finally{busy=false;}
    }
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        string build="D:/CYBR-build/exploded-instrument";
        if(args.Length>=2 && args[0]=="--build")build=args[1];
        var window=new BakeWindow(build);
        if(args.Length>=2 && args[0]=="--snapshot") {
            var timer=new Timer{Interval=8000};timer.Tick+=delegate{
                timer.Stop();using(var image=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(image,new Rectangle(0,0,image.Width,image.Height));image.Save(args[1]);}
                File.WriteAllText(args[1]+".json",new JavaScriptSerializer().Serialize(window.state));timer.Dispose();window.Close();
            };timer.Start();
        }
        Application.Run(window);
    }
}
