using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class Program {
    static void Main(string[] args) {
        string nodePath = @"C:\Program Files\nodejs\node.exe";
        if (!File.Exists(nodePath)) {
            nodePath = "node.exe";
        }

        string scriptPath = @"C:\Users\SIR\human-browser\host\dist\index.cjs";
        if (!File.Exists(scriptPath)) {
            scriptPath = @"C:\Users\SIR\human-browser\host\dist\index.js";
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = nodePath;
        psi.Arguments = string.Format("\"{0}\" --native", scriptPath);
        psi.WorkingDirectory = @"C:\Users\SIR\human-browser\host";
        psi.UseShellExecute = false;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.CreateNoWindow = true;

        Process proc = null;
        try {
            proc = Process.Start(psi);
        } catch (Exception ex) {
            return;
        }

        if (proc == null) return;

        // Pipe stdin -> child stdin
        Thread inThread = new Thread(() => {
            try {
                using (Stream stdIn = Console.OpenStandardInput())
                using (Stream childIn = proc.StandardInput.BaseStream) {
                    stdIn.CopyTo(childIn);
                }
            } catch {}
        });
        inThread.IsBackground = true;
        inThread.Start();

        // Pipe child stdout -> parent stdout
        Thread outThread = new Thread(() => {
            try {
                using (Stream childOut = proc.StandardOutput.BaseStream)
                using (Stream stdOut = Console.OpenStandardOutput()) {
                    childOut.CopyTo(stdOut);
                }
            } catch {}
        });
        outThread.IsBackground = true;
        outThread.Start();

        proc.WaitForExit();
    }
}
