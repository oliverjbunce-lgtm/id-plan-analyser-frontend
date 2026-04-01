"use client";
import { useState, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Upload, FileText, CheckCircle, AlertCircle, Download,
  RotateCcw, Loader2, ChevronLeft, ChevronRight, Send, X,
  CheckCircle2, Mail,
} from "lucide-react";
import type { BoundingBox, CorrectedBox } from "./components/types";

const PlanEditor = dynamic(() => import("./components/PlanEditor"), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-[24px] border border-black/5 bg-black/5 animate-pulse" style={{ minHeight: 360 }} />
  ),
});

const API_URL    = process.env.NEXT_PUBLIC_API_URL  || "http://localhost:8000";
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "https://independent-doors-customer-portal.vercel.app";
const PORTAL_API_KEY = "id-internal-import-key";

type Status = "idle" | "uploading" | "selecting" | "processing" | "reviewing" | "done" | "error";

interface PageThumb  { page: number; url: string; }
interface Detection  { class: string; count: number; }
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

// ── Door class → Customer Portal field mapping ────────────────────────────────

const CLASS_TO_PORTAL: Record<string, { hanging: string; frameType: string; notes: string }> = {
  L_prehung_door:               { hanging: 'LH',      frameType: 'Standard', notes: '' },
  R_prehung_door:               { hanging: 'RH',      frameType: 'Standard', notes: '' },
  Double_prehung_door:          { hanging: 'LH',      frameType: 'Standard', notes: 'Double prehung' },
  S_cavity_slider:              { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Single cavity slider' },
  D_cavity_slider:              { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Double cavity slider' },
  Wardrobe_sliding_two_doors_1: { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Wardrobe 2-door' },
  Wardrobe_sliding_two_doors_2: { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Wardrobe 2-door' },
  Wardrobe_sliding_three_doors: { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Wardrobe 3-door' },
  Wardrobe_sliding_four_doors:  { hanging: 'Slider',  frameType: 'Cavity',   notes: 'Wardrobe 4-door' },
  Bi_folding_door:              { hanging: 'Bi-Fold', frameType: 'Bifold',   notes: 'Bi-fold door' },
  D_bi_folding_door:            { hanging: 'Bi-Fold', frameType: 'Bifold',   notes: 'Double bi-fold' },
  Barn_wall_slider:             { hanging: 'Slider',  frameType: 'Custom',   notes: 'Barn wall slider' },
};

const CLASS_LABELS: Record<string, string> = {
  L_prehung_door:               "L Prehung Door",
  R_prehung_door:               "R Prehung Door",
  Double_prehung_door:          "Double Prehung Door",
  S_cavity_slider:              "Single Cavity Slider",
  D_cavity_slider:              "Double Cavity Slider",
  Wardrobe_sliding_two_doors_1: "Wardrobe Sliding 2-Door (A)",
  Wardrobe_sliding_two_doors_2: "Wardrobe Sliding 2-Door (B)",
  Wardrobe_sliding_three_doors: "Wardrobe Sliding 3-Door",
  Wardrobe_sliding_four_doors:  "Wardrobe Sliding 4-Door",
  Bi_folding_door:              "Bi-Folding Door",
  D_bi_folding_door:            "Double Bi-Folding Door",
  Barn_wall_slider:             "Barn Wall Slider",
};

// Must match CLASS_IDS in PlanEditor.tsx (kept in sync manually)
const CLASS_COLORS: Record<string, string> = {
  L_prehung_door:               "#3B82F6",
  R_prehung_door:               "#8B5CF6",
  Double_prehung_door:          "#EC4899",
  S_cavity_slider:              "#10B981",
  D_cavity_slider:              "#059669",
  Wardrobe_sliding_two_doors_1: "#F59E0B",
  Wardrobe_sliding_two_doors_2: "#D97706",
  Wardrobe_sliding_three_doors: "#EF4444",
  Wardrobe_sliding_four_doors:  "#DC2626",
  Bi_folding_door:              "#6366F1",
  D_bi_folding_door:            "#4F46E5",
  Barn_wall_slider:             "#14B8A6",
};

// Reverse of CLASS_IDS in PlanEditor.tsx
const CLASS_ID_TO_NAME: Record<number, string> = {
  0:  "L_prehung_door",
  1:  "R_prehung_door",
  2:  "Double_prehung_door",
  3:  "S_cavity_slider",
  4:  "D_cavity_slider",
  5:  "Wardrobe_sliding_two_doors_1",
  6:  "Wardrobe_sliding_two_doors_2",
  7:  "Wardrobe_sliding_four_doors",
  8:  "Bi_folding_door",
  9:  "Barn_wall_slider",
  10: "D_bi_folding_door",
  11: "Wardrobe_sliding_three_doors",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [status, setStatus]                   = useState<Status>("idle");
  const [file, setFile]                       = useState<File | null>(null);
  const [uploadSessionId, setUploadSessionId] = useState<string>("");
  const [pages, setPages]                     = useState<PageThumb[]>([]);
  const [selectedPages, setSelectedPages]     = useState<number[]>([]);
  const [pageResults, setPageResults]         = useState<PageResult[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [reviewingIdx, setReviewingIdx]       = useState(0);
  const [allLiveClasses, setAllLiveClasses]   = useState<Record<number, string[]>>({});
  const [submittedPages, setSubmittedPages]   = useState<Set<number>>(new Set());
  const [correctedBoxesPerPage, setCorrectedBoxesPerPage] = useState<Record<number, CorrectedBox[]>>({});
  const [finalDetections, setFinalDetections] = useState<Detection[]>([]);
  const [finalTotal, setFinalTotal]           = useState(0);
  const [error, setError]                     = useState<string>("");
  const [dragOver, setDragOver]               = useState(false);
  const [showToast, setShowToast]             = useState(false);
  const [toastMessage, setToastMessage]       = useState("");

  // Portal modal state
  const [showPortalModal, setShowPortalModal] = useState(false);
  const [portalEmail, setPortalEmail]         = useState('');
  const [portalSending, setPortalSending]     = useState(false);
  const [portalSent, setPortalSent]           = useState(false);
  const [portalError, setPortalError]         = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  const fireToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 4000);
  };

  // ── Combined live schedule ────────────────────────────────────────────────

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
  const displayTotal      = status === "done" ? finalTotal      : liveTotal;

  // ── File handling ─────────────────────────────────────────────────────────

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
      const res  = await fetch(`${API_URL}/upload`, { method: "POST", body: form });
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

  // ── Multi-page analysis ───────────────────────────────────────────────────

  const handleAnalyse = async () => {
    if (selectedPages.length === 0) return;
    setStatus("processing");
    setAnalysisProgress({ done: 0, total: selectedPages.length });

    const results: PageResult[]           = [];
    const initClasses: Record<number, string[]> = {};

    for (const pageNum of selectedPages) {
      try {
        const form = new FormData();
        form.append("session_id", uploadSessionId);
        form.append("page", String(pageNum));
        const res  = await fetch(`${API_URL}/analyse-stored`, { method: "POST", body: form });
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

  // ── Per-page feedback submission ──────────────────────────────────────────

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
          image_b64:  imageB64,
          boxes:      correctedBoxes,
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      const newSubmitted = new Set(submittedPages).add(current.pageNum);
      setSubmittedPages(newSubmitted);
      setCorrectedBoxesPerPage(prev => ({ ...prev, [current.pageNum]: correctedBoxes }));

      if (newSubmitted.size === pageResults.length) {
        setFinalDetections(liveDetections);
        setFinalTotal(liveTotal);
        setStatus("done");
      } else {
        const nextIdx = pageResults.findIndex((r, i) => i > reviewingIdx && !newSubmitted.has(r.pageNum));
        setReviewingIdx(nextIdx !== -1 ? nextIdx : pageResults.findIndex(r => !newSubmitted.has(r.pageNum)));
        fireToast(`Page ${current.pageNum} saved — ${pageResults.length - newSubmitted.size} page${pageResults.length - newSubmitted.size !== 1 ? "s" : ""} remaining`);
      }
    } catch {
      fireToast("Failed to save corrections. Please try again.");
    }
  };

  // ── CSV download ──────────────────────────────────────────────────────────

  const downloadCSV = () => {
    const rows = [
      ["Door Type", "Quantity"],
      ...displayDetections.map(d => [CLASS_LABELS[d.class] || d.class, d.count]),
      ["", ""],
      ["Total", displayTotal],
    ];
    const csv  = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${file?.name.replace(".pdf", "") ?? "plan"}-doors.csv`;
    a.click();
  };

  // ── Annotated image compositing ───────────────────────────────────────────

  const composeAnnotatedImages = async (): Promise<string[]> => {
    const results: string[] = [];
    for (const page of pageResults) {
      if (!submittedPages.has(page.pageNum)) continue;
      const boxes = correctedBoxesPerPage[page.pageNum] || [];

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      const img = new window.Image();
      const src = page.image_b64.startsWith("data:")
        ? page.image_b64
        : `data:image/png;base64,${page.image_b64}`;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = src;
      });

      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const lineWidth = Math.max(2, canvas.width / 500);
      const fontSize  = Math.max(11, Math.round(canvas.width / 70));

      for (const box of boxes) {
        const className = CLASS_ID_TO_NAME[box.class_id] ?? "unknown";
        const color     = CLASS_COLORS[className] ?? "#6B7280";
        const label     = CLASS_LABELS[className] ?? className;

        const x = (box.x_center - box.width  / 2) * canvas.width;
        const y = (box.y_center - box.height / 2) * canvas.height;
        const w = box.width  * canvas.width;
        const h = box.height * canvas.height;

        ctx.strokeStyle = color;
        ctx.lineWidth   = lineWidth;
        ctx.strokeRect(x, y, w, h);

        ctx.font      = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(label, x, Math.max(y - 4, fontSize + 2));
      }

      results.push(canvas.toDataURL("image/png"));
    }
    return results;
  };

  // ── Send to Portal ────────────────────────────────────────────────────────

  const sendToPortal = async () => {
    setPortalSending(true);
    setPortalError('');

    // Expand detections into individual door rows
    const doors: any[] = [];
    let doorIndex = 1;
    for (const det of finalDetections) {
      const mapping = CLASS_TO_PORTAL[det.class] || { hanging: 'LH', frameType: 'Standard', notes: det.class };
      for (let i = 0; i < det.count; i++) {
        doors.push({
          id:           crypto.randomUUID(),
          location:     `Door ${doorIndex++}`,
          hanging:      mapping.hanging,
          height:       '1980',
          width:        '760',
          thickness:    '35',
          trimHeight:   '',
          trimWidth:    '',
          floorGap:     '20',
          gibFrameSize: '90',
          softClose:    false,
          doorFinish:   'Primed',
          doorCore:     'Honeycomb',
          frameType:    mapping.frameType,
          hardwareCode: '',
          notes:        mapping.notes,
        });
      }
    }

    try {
      const annotatedImages = await composeAnnotatedImages();

      const res = await fetch(`${PORTAL_URL}/api/orders/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    PORTAL_API_KEY,
        },
        body: JSON.stringify({
          email:           portalEmail,
          doors,
          jobName:         file?.name.replace(/\.pdf$/i, '') || 'Floor Plan Import',
          floorPlanImages: annotatedImages,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setPortalSent(true);
    } catch (err: unknown) {
      setPortalError(err instanceof Error ? err.message : 'Failed to send to portal');
    } finally {
      setPortalSending(false);
    }
  };

  const closePortalModal = () => {
    setShowPortalModal(false);
    setPortalEmail('');
    setPortalSending(false);
    setPortalSent(false);
    setPortalError('');
  };

  // ── Reset ─────────────────────────────────────────────────────────────────

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
    setCorrectedBoxesPerPage({});
    setFinalDetections([]);
    setFinalTotal(0);
    setError("");
    setShowToast(false);
    closePortalModal();
  };

  const currentResult = pageResults[reviewingIdx];
  const isLastUnsubmitted =
    pageResults.filter(r => !submittedPages.has(r.pageNum)).length === 1 &&
    !submittedPages.has(currentResult?.pageNum);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header style={{ background: '#0b1f33' }} className="px-6 h-14 flex items-center shrink-0">
        <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
          {/* ID Logo */}
          <img
            src="https://iddoors.co.nz/wp-content/uploads/2023/11/logo.svg"
            alt="Independent Doors"
            className="h-7 w-auto"
          />
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-xs font-medium hidden sm:block">Plan Analyser</span>
            {status !== "idle" && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 text-xs font-medium text-white/60 hover:text-white transition-colors bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-[10px]"
              >
                <RotateCcw className="w-3 h-3" />
                New plan
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 sm:px-6 sm:py-10">

        {/* ── IDLE ── */}
        {status === "idle" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-[#0b1f33] mb-2">Analyse a building plan</h2>
              <p className="text-black/40 text-sm">Upload a PDF and the AI will detect and count all door types automatically.</p>
            </div>
            <div
              className={`upload-zone rounded-[24px] p-8 sm:p-14 text-center cursor-pointer bg-white ${dragOver ? "drag-over" : ""}`}
              style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.04)', border: dragOver ? '2px dashed #007AFF' : undefined }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <div className="w-14 h-14 rounded-[16px] bg-[#007AFF]/10 flex items-center justify-center mx-auto mb-4">
                <Upload className="w-6 h-6 text-[#007AFF]" />
              </div>
              <p className="text-[#0b1f33] font-semibold text-base sm:text-lg mb-1">Drop your PDF here</p>
              <p className="text-black/40 text-sm sm:text-base">or tap to browse</p>
              <input ref={inputRef} type="file" accept=".pdf,.PDF" className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          </div>
        )}

        {/* ── UPLOADING ── */}
        {status === "uploading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-[#007AFF] spinner" />
            <p className="text-black/50 text-sm">Uploading {file?.name}…</p>
          </div>
        )}

        {/* ── PAGE SELECTION ── */}
        {status === "selecting" && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-[#0b1f33] mb-1">Select pages to analyse</h2>
              <p className="text-black/40 text-sm">
                We&apos;ve suggested the most likely floor plan page. Select as many pages as you need.
              </p>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-black/50">
                <span className="font-semibold text-[#0b1f33]">{selectedPages.length}</span> page{selectedPages.length !== 1 ? "s" : ""} selected
              </span>
              <button onClick={() => setSelectedPages(pages.map(p => p.page))}
                className="text-xs text-[#007AFF] hover:underline font-medium">Select all</button>
              <button onClick={() => setSelectedPages([])}
                className="text-xs text-black/30 hover:underline">Clear</button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
              {pages.map(p => {
                const isSelected = selectedPages.includes(p.page);
                return (
                  <button key={p.page} onClick={() => togglePage(p.page)}
                    className={`relative rounded-[16px] overflow-hidden transition-all ${
                      isSelected
                        ? "ring-2 ring-[#007AFF] ring-offset-1 shadow-md"
                        : "ring-1 ring-black/8 hover:ring-black/20"
                    }`}
                    style={{ boxShadow: isSelected ? '0 4px 16px rgba(0,122,255,0.18)' : undefined }}
                  >
                    <img src={p.url} alt={`Page ${p.page}`} className="w-full object-cover" />
                    <div className={`absolute inset-0 ${isSelected ? "bg-[#007AFF]/10" : ""}`} />
                    <div className="absolute inset-0 flex items-end justify-start p-1.5">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-[6px] ${
                        isSelected ? "bg-[#007AFF] text-white" : "bg-white/80 text-[#0b1f33]"
                      }`}>{p.page}</span>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5">
                        <CheckCircle className="w-4 h-4 text-[#007AFF] fill-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleAnalyse}
              disabled={selectedPages.length === 0}
              className="bg-[#007AFF] hover:bg-[#0066DD] disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-[14px] text-sm font-semibold transition-colors shadow-sm shadow-[#007AFF]/20"
            >
              Analyse {selectedPages.length} page{selectedPages.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}

        {/* ── PROCESSING ── */}
        {status === "processing" && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <Loader2 className="w-8 h-8 text-[#007AFF] spinner" />
            <div className="text-center">
              <p className="text-[#0b1f33] font-semibold mb-1">
                Analysing page {analysisProgress.done + 1} of {analysisProgress.total}…
              </p>
              <p className="text-black/40 text-sm mb-4">
                {analysisProgress.done} of {analysisProgress.total} complete
              </p>
              <div className="w-48 h-1.5 bg-black/8 rounded-full overflow-hidden mx-auto">
                <div
                  className="h-full bg-[#007AFF] rounded-full transition-all duration-500"
                  style={{ width: `${(analysisProgress.done / analysisProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── REVIEWING ── */}
        {status === "reviewing" && currentResult && (
          <div className="space-y-4">
            <div className="flex items-start sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#0b1f33]">Review detections</h2>
                <p className="text-sm text-black/40 mt-0.5">
                  {pageResults.length > 1
                    ? `${pageResults.length} pages analysed · ${submittedPages.size} of ${pageResults.length} confirmed`
                    : `${currentResult.total} door${currentResult.total !== 1 ? "s" : ""} detected on page ${currentResult.pageNum}`}
                </p>
              </div>
              <button onClick={downloadCSV}
                className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-black/40 hover:text-[#007AFF] transition-colors bg-black/5 hover:bg-[#007AFF]/8 px-3 py-2 sm:py-1.5 rounded-[10px]">
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {/* Page tabs */}
            {pageResults.length > 1 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="overflow-x-auto flex gap-2 pb-1 flex-1 min-w-0">
                  {pageResults.map((r, idx) => {
                    const isDone    = submittedPages.has(r.pageNum);
                    const isCurrent = idx === reviewingIdx;
                    return (
                      <button key={r.pageNum} onClick={() => setReviewingIdx(idx)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all border shrink-0 ${
                          isCurrent
                            ? "bg-[#007AFF] text-white border-[#007AFF] shadow-sm shadow-[#007AFF]/20"
                            : isDone
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-white text-black/50 border-black/8 hover:border-black/20"
                        }`}>
                        Page {r.pageNum}
                        {isDone && <CheckCircle className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setReviewingIdx(i => Math.max(0, i - 1))}
                    disabled={reviewingIdx === 0}
                    className="p-1.5 rounded-[10px] border border-black/8 text-black/30 hover:text-black/60 disabled:opacity-30 transition-colors bg-white">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-black/30 px-1">{reviewingIdx + 1} / {pageResults.length}</span>
                  <button onClick={() => setReviewingIdx(i => Math.min(pageResults.length - 1, i + 1))}
                    disabled={reviewingIdx === pageResults.length - 1}
                    className="p-1.5 rounded-[10px] border border-black/8 text-black/30 hover:text-black/60 disabled:opacity-30 transition-colors bg-white">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Plan editor */}
              <div className="xl:col-span-2">
                <h3 className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-2">
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
                    isLastUnsubmitted ? "Confirm & Submit All" : `Confirm page ${currentResult.pageNum} →`
                  }
                />
              </div>

              {/* Door schedule sidebar */}
              <div>
                <h3 className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-2">
                  {pageResults.length > 1 ? "Combined Door Schedule" : "Door Schedule"}
                </h3>
                <div className="bg-white rounded-[24px] overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.03)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black/5">
                        <th className="text-left px-4 py-3 text-xs text-black/40 font-semibold">Door Type</th>
                        <th className="text-right px-4 py-3 text-xs text-black/40 font-semibold">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDetections.length > 0 ? displayDetections.map((d, i) => (
                        <tr key={i} className="border-b border-black/[0.03] hover:bg-black/[0.02] transition-colors">
                          <td className="px-4 py-3 text-[#0b1f33]">{CLASS_LABELS[d.class] || d.class}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0b1f33]">{d.count}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={2} className="px-4 py-6 text-center text-xs text-black/30">No doors detected yet</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-black/[0.02]">
                        <td className="px-4 py-3 text-sm font-bold text-[#0b1f33]">Total</td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-[#0b1f33]">{displayTotal}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Tip card */}
                <div className="mt-4 p-4 rounded-[16px] bg-[#007AFF]/8 border border-[#007AFF]/10">
                  <p className="text-xs text-[#007AFF] font-semibold mb-1">How to correct detections</p>
                  <ul className="text-xs text-[#007AFF]/80 space-y-1 list-disc list-inside">
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

        {/* ── DONE ── */}
        {status === "done" && (
          <div className="max-w-lg mx-auto">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-[#0b1f33] mb-1">Analysis complete</h2>
              <p className="text-sm text-black/40">
                {finalTotal} door{finalTotal !== 1 ? "s" : ""} confirmed
                {pageResults.length > 1
                  ? ` across ${pageResults.length} pages`
                  : ` on page ${pageResults[0]?.pageNum}`} of{" "}
                <span className="font-semibold text-[#0b1f33]">{file?.name}</span>
              </p>
            </div>

            {/* Results card */}
            <div className="bg-white rounded-[24px] overflow-hidden mb-6" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.03)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5 bg-black/[0.015]">
                    <th className="text-left px-5 py-3.5 text-xs text-black/40 font-semibold">Door Type</th>
                    <th className="text-right px-5 py-3.5 text-xs text-black/40 font-semibold">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {finalDetections.map((d, i) => (
                    <tr key={i} className="border-b border-black/[0.03]">
                      <td className="px-5 py-3.5 text-[#0b1f33]">{CLASS_LABELS[d.class] || d.class}</td>
                      <td className="px-5 py-3.5 text-right font-semibold text-[#0b1f33]">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-black/[0.02]">
                    <td className="px-5 py-4 text-sm font-bold text-[#0b1f33]">Total</td>
                    <td className="px-5 py-4 text-right text-sm font-bold text-[#0b1f33]">{finalTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowPortalModal(true)}
                className="w-full flex items-center justify-center gap-2 bg-[#007AFF] hover:bg-[#0066DD] text-white px-4 py-3.5 rounded-[14px] text-sm font-semibold transition-colors shadow-sm shadow-[#007AFF]/20"
              >
                <Send className="w-4 h-4" />
                Send to Customer Portal
              </button>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={downloadCSV}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-black/5 hover:bg-black/8 text-[#007AFF] px-4 py-3 rounded-[14px] text-sm font-semibold transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download CSV
                </button>
                <button
                  onClick={reset}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-black/5 hover:bg-black/8 text-[#007AFF] px-4 py-3 rounded-[14px] text-sm font-semibold transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  New plan
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {status === "error" && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-[#0b1f33] font-bold text-lg mb-2">Something went wrong</h2>
            <p className="text-black/40 text-sm mb-6">{error}</p>
            <button
              onClick={reset}
              className="bg-[#0b1f33] hover:bg-[#0b1f33]/80 text-white px-6 py-3 rounded-[14px] text-sm font-semibold transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-black/5 px-6 py-4 text-center">
        <p className="text-xs text-black/25">Independent Doors — Internal use only</p>
      </footer>

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {showToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-[#0b1f33] text-white text-sm font-medium px-5 py-3 rounded-[14px] shadow-lg animate-fade-in">
          <CheckCircle className="w-4 h-4 text-[#FFD60A] shrink-0" />
          {toastMessage}
        </div>
      )}

      {/* ── Send to Customer Portal modal ───────────────────────────────────── */}
      {showPortalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-md overflow-hidden" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.15)' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#007AFF] rounded-[12px] flex items-center justify-center shadow-sm shadow-[#007AFF]/25">
                  <Send className="w-4 h-4 text-white" />
                </div>
                <h2 className="text-base font-bold text-[#0b1f33]">Send to Customer Portal</h2>
              </div>
              <button onClick={closePortalModal}
                className="p-1.5 text-black/30 hover:text-black/60 hover:bg-black/5 rounded-[10px] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 space-y-5">
              {!portalSent ? (
                <>
                  <p className="text-sm text-black/50 leading-relaxed">
                    We&apos;ll create a pre-filled draft order in the portal using your saved default specs —{" "}
                    <span className="font-semibold text-[#0b1f33]">{finalTotal} door{finalTotal !== 1 ? 's' : ''}</span> from{" "}
                    <span className="font-semibold text-[#0b1f33]">{file?.name}</span>.
                  </p>

                  {/* Door count summary */}
                  <div className="bg-black/[0.025] rounded-[16px] p-4 space-y-1.5">
                    {finalDetections.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-black/60">{CLASS_LABELS[d.class] || d.class}</span>
                        <span className="font-semibold text-[#0b1f33] tabular-nums">×{d.count}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-sm font-bold text-[#0b1f33] border-t border-black/8 pt-2 mt-2">
                      <span>Total</span>
                      <span>{finalTotal}</span>
                    </div>
                  </div>

                  {/* Email input */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#0b1f33]">Your Customer Portal email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                      <input
                        type="email"
                        value={portalEmail}
                        onChange={e => { setPortalEmail(e.target.value); setPortalError(''); }}
                        placeholder="you@company.com"
                        className="w-full pl-10 pr-4 py-3 bg-white border border-black/10 rounded-[14px] text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]/40 transition-all placeholder:text-black/25"
                        onKeyDown={e => { if (e.key === 'Enter' && portalEmail) sendToPortal(); }}
                      />
                    </div>
                    <p className="text-xs text-black/30">Must match your Customer Portal account email</p>
                  </div>

                  {portalError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 text-sm font-medium px-4 py-3 rounded-[14px]">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {portalError}
                    </div>
                  )}

                  <button
                    onClick={sendToPortal}
                    disabled={!portalEmail || portalSending}
                    className="w-full flex items-center justify-center gap-2 bg-[#007AFF] hover:bg-[#0066DD] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-[14px] text-sm transition-colors shadow-sm shadow-[#007AFF]/20"
                  >
                    {portalSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Send className="w-4 h-4" /> Create Draft Order</>
                    )}
                  </button>
                </>
              ) : (
                /* Success state */
                <div className="text-center py-4 space-y-4">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <div>
                    <p className="font-bold text-[#0b1f33] text-lg">Draft order created!</p>
                    <p className="text-sm text-black/40 mt-1">
                      Open the Customer Portal and go to <strong className="text-[#0b1f33]">Account Settings → Drafts</strong> to review and submit.
                    </p>
                  </div>
                  <a
                    href={PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#007AFF] hover:bg-[#0066DD] text-white font-semibold px-5 py-3 rounded-[14px] text-sm transition-colors shadow-sm shadow-[#007AFF]/20"
                  >
                    Open Customer Portal
                    <ArrowRight className="w-4 h-4" />
                  </a>
                  <button onClick={closePortalModal}
                    className="block w-full text-center text-sm text-black/30 hover:text-black/50 transition-colors mt-2">
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline ArrowRight for modal success (avoids separate import clutter) ──────
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}
