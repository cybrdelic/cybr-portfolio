@echo off
call C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /openmp:llvm /fp:precise /I"%~1\shared" /I"%~2\native" "%~3\native-overlay\spectral_desert.cpp" /Fe:"%~3\hot-reference.exe" /Fo:"%~3\hot-reference.obj"
exit /b %errorlevel%
