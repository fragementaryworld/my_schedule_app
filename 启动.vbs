Option Explicit
Dim shell, fso, root, powershell, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Chr(34) & powershell & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & fso.BuildPath(root, "launch-background.ps1") & Chr(34)
On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  If WScript.Interactive Then MsgBox "Unable to start the app: " & Err.Description, 16, "Schedule App"
  WScript.Quit 1
End If
If exitCode <> 0 Then
  If WScript.Interactive Then MsgBox "Unable to start the app. Run npm start in the project directory to see the error.", 16, "Schedule App"
End If
WScript.Quit exitCode
