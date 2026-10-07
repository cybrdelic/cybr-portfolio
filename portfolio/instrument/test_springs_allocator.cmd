@echo off
call C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /EHsc "%~dp0test_springs_allocator.cpp" /Fe:"%~1\allocator-test.exe" /Fo:"%~1\allocator-test.obj"
if errorlevel 1 exit /b 1
"%~1\allocator-test.exe"
exit /b %errorlevel%
