"use client";
import { useState, useCallback, useRef } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, Download, RotateCcw, Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Status = "idle" | "uploading" | "selecting" | "processing" | "done" | "error";

interface PageThumb { page: number; url: string; }
interface Detection { class: string; count: number; }
interface Results {
  image_b64: string;
  detections: Detection[];
  total: number;
  page_used: number;
}

const CLASS_LABELS: Record<string, string> = {
  L_prehung_door: "L Prehung Door",
  R_prehung_door: "R Prehung Door",
  Double_prehung_door: "Double Prehung Door",
  S_cavity_slider: "Single Cavity Slider",
  D_cavity_slider: "Double Cavity Slider",
  Wardrobe_sliding_two_doors_1: "Wardrobe Sliding 2-Door (A)",
  Wardrobe_sliding_two_doors_2: "Wardrobe Sliding 2-Door (B)",
  Wardrobe_sliding_three_doors: "Wardrobe Sliding 3-Door",
  Wardrobe_sliding_four_doors: "Wardrobe Sliding 4-Door",
  Bi_folding_door: "Bi-Folding Door",
  D_bi_folding_door: "Double Bi-Folding Door",
  Barn_wall_slider: "Barn Wall Slider",
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageThumb[]>([]);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      setStatus("error");
      return;
    }
    setFile(f);
    setError("");
    setStatus("uploading");

    const form = new FormData();
    form.append("file", f);

    try {
      const res = await fetch(`${API_URL}/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPages(data.pages);
      setSelectedPage(data.suggested_page);
      setStatus("selecting");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setStatus("error");
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleAnalyse = async () => {
    if (!file) return;
    setStatus("processing");
    const form = new FormData();
    form.append("file", file);
    form.append("page", String(selectedPage));
    try {
      const res = await fetch(`${API_URL}/analyse`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data);
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
      setStatus("error");
    }
  };

  const reset = () => {
    setStatus("idle");
    setFile(null);
    setPages([]);
    setResults(null);
    setError("");
  };

  const downloadCSV = () => {
    if (!results) return;
    const rows = [
      ["Door Type", "Quantity"],
      ...results.detections.map(d => [CLASS_LABELS[d.class] || d.class, d.count]),
      ["", ""],
      ["Total", results.total],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name.replace(".pdf", "")}-doors.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Independent Doors</h1>
              <p className="text-xs text-gray-500">Plan Analyser</p>
            </div>
          </div>
          {status !== "idle" && (
            <button onClick={reset} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />
              New plan
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">

        {/* IDLE — Upload */}
        {status === "idle" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Analyse a building plan</h2>
              <p className="text-gray-500 text-sm">Upload a PDF and the AI will detect and count all door types automatically.</p>
            </div>
            <div
              className={`upload-zone rounded-xl p-12 text-center cursor-pointer bg-white ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-1">Drop your PDF here</p>
              <p className="text-gray-400 text-sm">or click to browse</p>
              <input ref={inputRef} type="file" accept=".pdf,.PDF" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          </div>
        )}

        {/* UPLOADING */}
        {status === "uploading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-blue-600 spinner" />
            <p className="text-gray-600 text-sm">Uploading {file?.name}…</p>
          </div>
        )}

        {/* PAGE SELECTION */}
        {status === "selecting" && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Select the floor plan page</h2>
              <p className="text-gray-500 text-sm">We&apos;ve suggested the most likely floor plan page. Confirm or select a different one.</p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
              {pages.map(p => (
                <button
                  key={p.page}
                  onClick={() => setSelectedPage(p.page)}
                  className={`relative rounded-lg border-2 overflow-hidden transition-all ${
                    selectedPage === p.page
                      ? "border-blue-600 shadow-md"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <img src={p.url} alt={`Page ${p.page}`} className="w-full object-cover" />
                  <div className={`absolute inset-0 flex items-end justify-start p-1.5 ${selectedPage === p.page ? "bg-blue-600/10" : ""}`}>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      selectedPage === p.page ? "bg-blue-600 text-white" : "bg-white/80 text-gray-700"
                    }`}>
                      {p.page}
                    </span>
                  </div>
                  {selectedPage === p.page && (
                    <div className="absolute top-1.5 right-1.5">
                      <CheckCircle className="w-4 h-4 text-blue-600 fill-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={handleAnalyse}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Analyse page {selectedPage}
            </button>
          </div>
        )}

        {/* PROCESSING */}
        {status === "processing" && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-blue-600 spinner" />
            <div className="text-center">
              <p className="text-gray-700 font-medium mb-1">Detecting doors…</p>
              <p className="text-gray-400 text-sm">Running AI analysis on page {selectedPage}</p>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {status === "done" && results && (
          <div className="result-card grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Annotated plan image */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Detected Doors</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <img src={results.image_b64} alt="Annotated plan" className="w-full" />
              </div>
            </div>

            {/* Door count table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Door Schedule</h2>
                <button onClick={downloadCSV} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Door Type</th>
                      <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.detections.map((d, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-800">{CLASS_LABELS[d.class] || d.class}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">{results.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="mt-4 p-4 bg-green-50 border border-green-100 rounded-xl flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">{results.total} doors detected</p>
                  <p className="text-xs text-green-600 mt-0.5">Review the plan image to verify detections before quoting.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ERROR */}
        {status === "error" && (
          <div className="max-w-md mx-auto text-center py-16">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-4" />
            <h2 className="text-gray-900 font-semibold mb-2">Something went wrong</h2>
            <p className="text-gray-500 text-sm mb-6">{error}</p>
            <button onClick={reset} className="bg-gray-900 hover:bg-gray-700 text-white px-5 py-2 rounded-lg text-sm transition-colors">
              Try again
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 px-6 py-4 text-center">
        <p className="text-xs text-gray-400">Independent Doors — Internal use only</p>
      </footer>
    </div>
  );
}
