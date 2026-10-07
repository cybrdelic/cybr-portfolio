$ErrorActionPreference = 'Stop'
$compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'BakeProgress.cs'
$appPath = Join-Path $PSScriptRoot 'CYBR-Light-Progress.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll /out:$appPath $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Windows app build failed' }
Get-Item -LiteralPath $appPath | Select-Object FullName,Length
