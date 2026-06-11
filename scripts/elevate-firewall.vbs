Set shell = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\open-dashboard-firewall.ps1"
args = "-NoProfile -ExecutionPolicy Bypass -NoExit -File """ & ps1 & """"
shell.ShellExecute "powershell.exe", args, dir, "runas", 1
