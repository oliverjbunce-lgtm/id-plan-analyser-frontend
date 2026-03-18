"use client";
import { useState, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { Upload, FileText, CheckCircle, AlertCircle, Download, RotateCcw, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { BoundingBox, CorrectedBox } from "./components/types";

const PlanEditor = dynamic(() => import("./components/PlanEditor"), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-xl border border-gray-200 bg-gray-100 animate-pulse" style={{ minHeight: 360 }} />
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Status = "idle" | "uploading" | "selecting" | "processing" | "reviewing" | "done" | "error";

interface PageThumb { page: number; url: string; }
interface Detection { class: string; count: number; }
interface PageResult {
  pageNum: number;
  session_id: string;
  image_b64: string;
  boxes: BoundingBox[];
  image_width: number;
  image_height: number;
  detections: Detection[];
  total: number;
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
  const [uploadSessionId, setUploadSessionId] = useState<string>("");
  const [pages, setPages] = useState<PageThumb[]>([]);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [pageResults, setPageResults] = useState<PageResult[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [reviewingIdx, setReviewingIdx] = useState(0);
  const [allLiveClasses, setAllLiveClasses] = useState<Record<number, string[]>>({});
  const [submittedPages, setSubmittedPages] = useState<Set<number>>(new Set());
  const [finalDetections, setFinalDetections] = useState<Detection[]>([]);
  const [finalTotal, setFinalTotal] = useState(0);
  const [error, setError] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fireToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 4000);
  };

  // ── Combined live schedule across all pages ──────────────────────────────────
  const combinedLiveClasses = useMemo(
    () => Object.values(allLiveClasses).flat(),
    [allLiveClasses]
  );
  const liveDetections = useMemo<Detection[]>(() => {
    const counts: Record<string, number> = {};
    for (const cls of combinedLiveClasses) counts[cls] = (counts[cls] || 0) + 1;
    return Object.entries(counts)
      .map(([class_, count]) => ({ class: class_, count }))
      .sort((a, b) => b.count - a.count);
  }, [combinedLiveClasses]);
  const liveTotal = combinedLiveClasses.length;

  const displayDetections = status === "done" ? finalDetections : liveDetections;
  const displayTotal = status === "done" ? finalTotal : liveTotal;

  // ── File handling ─────────────────────────────────────────────────────────────
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
      setSelectedPages([data.suggested_page]);
      setUploadSessionId(data.session_id);
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

  const togglePage = (pageNum: number) => {
    setSelectedPages(prev =>
      prev.includes(pageNum)
        ? prev.filter(p => p !== pageNum)
        : [...prev, pageNum].sort((a, b) => a - b)
    );
  };

  // ── Multi-page analysis ───────────────────────────────────────────────────────
  const handleAnalyse = async () => {
    if (selectedPages.length === 0) return;
    setStatus("processing");
    setAnalysisProgress({ done: 0, total: selectedPages.length });

    const results: PageResult[] = [];
    const initClasses: Record<number, string[]> = {};

    for (const pageNum of selectedPages) {
      try {
        const form = new FormData();
        form.append("session_id", uploadSessionId);
        form.append("page", String(pageNum));
        const res = await fetch(`${API_URL}/analyse-stored`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const result: PageResult = { pageNum, ...data };
        results.push(result);
        initClasses[pageNum] = data.boxes.map((b: BoundingBox) => b.class);
        setAnalysisProgress(prev => ({ ...prev, done: prev.done + 1 }));
      } catch (e: unknown) {
        setError(`Failed to analyse page ${pageNum}: ${e instanceof Error ? e.message : "Unknown error"}`);
        setStatus("error");
        return;
      }
    }

    setPageResults(results);
    setAllLiveClasses(initClasses);
    setReviewingIdx(0);
    setStatus("reviewing");
  };

  // ── Per-page feedback submission ──────────────────────────────────────────────
  const handlePageSubmit = async (correctedBoxes: CorrectedBox[]) => {
    const current = pageResults[reviewingIdx];
    if (!current) return;

    const imageB64 = current.image_b64.replace(/^data:[^;]+;base64,/, "");
    try {
      const res = await fetch(`${API_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: current.session_id,
          image_b64: imageB64,
          boxes: correctedBoxes,
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      const newSubmitted = new Set(submittedPages).add(current.pageNum);
      setSubmittedPages(newSubmitted);

      if (newSubmitted.size === pageResults.length) {
        // All pages confirmed — done
        setFinalDetections(liveDetections);
        setFinalTotal(liveTotal);
        setStatus("done");
      } else {
        // Advance to next unconfirmed page
        const nextIdx = pageResults.findIndex((r, i) => i > reviewingIdx && !newSubmitted.has(r.pageNum));
        setReviewingIdx(nextIdx !== -1 ? nextIdx : pageResults.findIndex(r => !newSubmitted.has(r.pageNum)));
        fireToast(`Page ${current.pageNum} saved — ${pageResults.length - newSubmitted.size} page${pageResults.length - newSubmitted.size !== 1 ? "s" : ""} remaining`);
      }
    } catch (e: unknown) {
      fireToast("Failed to save corrections. Please try again.");
    }
  };

  const downloadCSV = () => {
    const rows = [
      ["Door Type", "Quantity"],
      ...displayDetections.map(d => [CLASS_LABELS[d.class] || d.class, d.count]),
      ["", ""],
      ["Total", displayTotal],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name.replace(".pdf", "") ?? "plan"}-doors.csv`;
    a.click();
  };

  const reset = () => {
    setStatus("idle");
    setFile(null);
    setUploadSessionId("");
    setPages([]);
    setSelectedPages([]);
    setPageResults([]);
    setAnalysisProgress({ done: 0, total: 0 });
    setReviewingIdx(0);
    setAllLiveClasses({});
    setSubmittedPages(new Set());
    setFinalDetections([]);
    setFinalTotal(0);
    setError("");
    setShowToast(false);
  };

  const currentResult = pageResults[reviewingIdx];
  const isLastUnsubmitted =
    pageResults.filter(r => !submittedPages.has(r.pageNum)).length === 1 &&
    !submittedPages.has(currentResult?.pageNum);

  // ── Render ────────────────────────────────────────────────────────────────────
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

        {/* IDLE */}
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

        {/* PAGE SELECTION — multi-select */}
        {status === "selecting" && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Select pages to analyse</h2>
              <p className="text-gray-500 text-sm">
                We&apos;ve suggested the most likely floor plan page. Select as many pages as you need.
              </p>
            </div>

            {/* Selection summary */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{selectedPages.length}</span> page{selectedPages.length !== 1 ? "s" : ""} selected
              </span>
              <button
                onClick={() => setSelectedPages(pages.map(p => p.page))}
                className="text-xs text-blue-600 hover:underline"
              >
                Select all
              </button>
              <button
                onClick={() => setSelectedPages([])}
                className="text-xs text-gray-400 hover:underline"
              >
                Clear
              </button>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
              {pages.map(p => {
                const isSelected = selectedPages.includes(p.page);
                return (
                  <button
                    key={p.page}
                    onClick={() => togglePage(p.page)}
                    className={`relative rounded-lg border-2 overflow-hidden transition-all ${
                      isSelected ? "border-blue-600 shadow-md" : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <img src={p.url} alt={`Page ${p.page}`} className="w-full object-cover" />
                    <div className={`absolute inset-0 ${isSelected ? "bg-blue-600/10" : ""}`} />
                    <div className="absolute inset-0 flex items-end justify-start p-1.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        isSelected ? "bg-blue-600 text-white" : "bg-white/80 text-gray-700"
                      }`}>
                        {p.page}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5">
                        <CheckCircle className="w-4 h-4 text-blue-600 fill-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleAnalyse}
              disabled={selectedPages.length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Analyse {selectedPages.length} page{selectedPages.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}

        {/* PROCESSING — with progress bar */}
        {status === "processing" && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-blue-600 spinner" />
            <div className="text-center">
              <p className="text-gray-700 font-medium mb-1">
                Analysing page {analysisProgress.done + 1} of {analysisProgress.total}…
              </p>
              <p className="text-gray-400 text-sm mb-3">
                {analysisProgress.done} of {analysisProgress.total} complete
              </p>
              <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden mx-auto">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-500"
                  style={{ width: `${(analysisProgress.done / analysisProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* REVIEWING — multi-page editor */}
        {status === "reviewing" && currentResult && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Review detections</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {pageResults.length > 1
                    ? `${pageResults.length} pages analysed · ${submittedPages.size} of ${pageResults.length} confirmed`
                    : `${currentResult.total} door${currentResult.total !== 1 ? "s" : ""} detected on page ${currentResult.pageNum}`
                  }
                </p>
              </div>
              <button
                onClick={downloadCSV}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {/* Page tabs (only shown when multiple pages) */}
            {pageResults.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                {pageResults.map((r, idx) => {
                  const isDone = submittedPages.has(r.pageNum);
                  const isCurrent = idx === reviewingIdx;
                  return (
                    <button
                      key={r.pageNum}
                      onClick={() => setReviewingIdx(idx)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        isCurrent
                          ? "bg-blue-600 text-white border-blue-600"
                          : isDone
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      Page {r.pageNum}
                      {isDone && <CheckCircle className="w-3 h-3" />}
                    </button>
                  );
                })}
                {/* Prev / next */}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => setReviewingIdx(i => Math.max(0, i - 1))}
                    disabled={reviewingIdx === 0}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-gray-400 px-1">
                    {reviewingIdx + 1} / {pageResults.length}
                  </span>
                  <button
                    onClick={() => setReviewingIdx(i => Math.min(pageResults.length - 1, i + 1))}
                    disabled={reviewingIdx === pageResults.length - 1}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Two-column layout */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Page {currentResult.pageNum} — click a box to edit
                </h3>
                <PlanEditor
                  key={currentResult.pageNum}
                  imageSrc={currentResult.image_b64}
                  boxes={currentResult.boxes}
                  imageWidth={currentResult.image_width}
                  imageHeight={currentResult.image_height}
                  onSubmit={handlePageSubmit}
                  onBoxesChange={(classes) =>
                    setAllLiveClasses(prev => ({ ...prev, [currentResult.pageNum]: classes }))
                  }
                  submitLabel={
                    isLastUnsubmitted
                      ? "Confirm & Submit All"
                      : `Confirm page ${currentResult.pageNum} →`
                  }
                />
              </div>

              {/* Combined schedule */}
              <div>
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  {pageResults.length > 1 ? "Combined Door Schedule" : "Door Schedule"}
                </h3>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Door Type</th>
                        <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDetections.length > 0 ? displayDetections.map((d, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-800">{CLASS_LABELS[d.class] || d.class}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">{d.count}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={2} className="px-4 py-6 text-center text-xs text-gray-400">No doors detected yet</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">{displayTotal}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-xs text-blue-700 font-medium mb-1">How to correct detections</p>
                  <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                    <li>Click a box to select it, then change type or delete</li>
                    <li>Drag a box to reposition it</li>
                    <li>Use corner handles to resize</li>
                    <li>Use &ldquo;+ Add door&rdquo; to draw a new box</li>
                    {pageResults.length > 1 && <li>Use page tabs to switch between plan pages</li>}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DONE */}
        {status === "done" && (
          <div className="max-w-lg mx-auto">
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Analysis complete</h2>
              <p className="text-sm text-gray-500">
                {finalTotal} door{finalTotal !== 1 ? "s" : ""} confirmed
                {pageResults.length > 1 ? ` across ${pageResults.length} pages` : ` on page ${pageResults[0]?.pageNum}`} of{" "}
                <span className="font-medium text-gray-700">{file?.name}</span>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Door Type</th>
                    <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {finalDetections.map((d, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-4 py-3 text-gray-800">{CLASS_LABELS[d.class] || d.class}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">Total</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{finalTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={downloadCSV}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Download CSV
              </button>
              <button
                onClick={reset}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Analyse another plan
              </button>
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

      {showToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg animate-fade-in">
          <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
          {toastMessage}
        </div>
      )}
    </div>
  );
}
