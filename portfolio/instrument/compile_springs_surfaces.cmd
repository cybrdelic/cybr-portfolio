@echo off
call C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /openmp:llvm /fp:precise /I"%~1\native-overlay" /I"%~2\engines\hot\cybr-geo\native" /I"%~2\shared" "%~dp0bake_springs_surfaces.cpp" /Fe:"%~1\bake-surfaces.exe" /Fo:"%~1\bake-surfaces.obj"
exit /b %errorlevel%
