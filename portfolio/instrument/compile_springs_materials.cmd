@echo off
call C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /fp:precise /I"%~2\engines\hot\cybr-geo\native" /I"%~2\shared" "%~dp0export_springs_materials.cpp" /Fe:"%~1\export-materials.exe" /Fo:"%~1\export-materials.obj"
exit /b %errorlevel%
