"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Text, Transformer, Group } from "react-konva";
import type Konva from "konva";
import type { BoundingBox, CorrectedBox } from "./types";
import { ZoomIn, ZoomOut, Maximize2, Minimize2 } from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────────

export const CLASS_COLORS: Record<string, string> = {
  L_prehung_door: "#3B82F6",
  R_prehung_door: "#8B5CF6",
  Double_prehung_door: "#EC4899",
  S_cavity_slider: "#10B981",
  D_cavity_slider: "#059669",
  Wardrobe_sliding_two_doors_1: "#F59E0B",
  Wardrobe_sliding_two_doors_2: "#D97706",
  Wardrobe_sliding_three_doors: "#EF4444",
  Wardrobe_sliding_four_doors: "#DC2626",
  Bi_folding_door: "#6366F1",
  D_bi_folding_door: "#4F46E5",
  Barn_wall_slider: "#14B8A6",
};

// Must match CLASSES order in backend main.py
const CLASS_IDS: Record<string, number> = {
  L_prehung_door: 0,
  R_prehung_door: 1,
  Double_prehung_door: 2,
  S_cavity_slider: 3,
  D_cavity_slider: 4,
  Wardrobe_sliding_two_doors_1: 5,
  Wardrobe_sliding_two_doors_2: 6,
  Wardrobe_sliding_four_doors: 7,
  Bi_folding_door: 8,
  Barn_wall_slider: 9,
  D_bi_folding_door: 10,
  Wardrobe_sliding_three_doors: 11,
};

// Compact labels for canvas (long names obscure the plan)
const SHORT_LABELS: Record<string, string> = {
  L_prehung_door: "L Prehung",
  R_prehung_door: "R Prehung",
  Double_prehung_door: "Dbl Prehung",
  S_cavity_slider: "S Cavity",
  D_cavity_slider: "D Cavity",
  Wardrobe_sliding_two_doors_1: "WD 2-Door A",
  Wardrobe_sliding_two_doors_2: "WD 2-Door B",
  Wardrobe_sliding_three_doors: "WD 3-Door",
  Wardrobe_sliding_four_doors: "WD 4-Door",
  Bi_folding_door: "Bi-Fold",
  D_bi_folding_door: "Dbl Bi-Fold",
  Barn_wall_slider: "Barn Slider",
};

const CLASS_LIST = Object.keys(CLASS_COLORS);

const MIN_SCALE = 0.2;
const MAX_SCALE = 12;
const ZOOM_FACTOR = 1.18;

// ── Types ──────────────────────────────────────────────────────────────────────

export type { BoundingBox, CorrectedBox } from "./types";

interface EditableBox {
  id: string;
  cls: string;
  // Normalized coords (0–1): top-left origin
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

interface PlanEditorProps {
  imageSrc: string;
  boxes: BoundingBox[];
  imageWidth: number;
  imageHeight: number;
  onSubmit: (correctedBoxes: CorrectedBox[]) => void;
  onBoxesChange?: (classes: string[]) => void;
}

// ── ID generator ───────────────────────────────────────────────────────────────
let _idCounter = 0;
function genId() {
  return `eb${++_idCounter}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PlanEditor({
  imageSrc,
  boxes,
  imageWidth,
  imageHeight,
  onSubmit,
  onBoxesChange,
}: PlanEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Container size (tracked by ResizeObserver)
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);

  // Image-aspect canvas height (used when not fullscreen)
  const imgScale = containerWidth / imageWidth;
  const canvasHeight = Math.round(imageHeight * imgScale);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const [editBoxes, setEditBoxes] = useState<EditableBox[]>(() =>
    boxes.map((b) => ({
      id: genId(),
      cls: b.class,
      nx: b.x1,
      ny: b.y1,
      nw: b.x2 - b.x1,
      nh: b.y2 - b.y1,
    }))
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addClass, setAddClass] = useState("L_prehung_door");
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [emptyWarning, setEmptyWarning] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Zoom / pan
  const [stageScale, setStageScale] = useState(1);
  const [stageOffset, setStageOffset] = useState({ x: 0, y: 0 });

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Responsive sizing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    if (clientWidth > 0) setContainerWidth(clientWidth);
    if (clientHeight > 0) setContainerHeight(clientHeight);

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0) setContainerWidth(width);
      if (height > 0) setContainerHeight(height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  // ── Load background image ──────────────────────────────────────────────────────
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setBgImage(img);
    img.src = imageSrc;
  }, [imageSrc]);

  // ── Attach transformer to selected node ───────────────────────────────────────
  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;
    if (selectedId) {
      const node = stageRef.current.findOne<Konva.Rect>(`#${selectedId}`);
      trRef.current.nodes(node ? [node] : []);
    } else {
      trRef.current.nodes([]);
    }
    trRef.current.getLayer()?.batchDraw();
  }, [selectedId, editBoxes]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setEditBoxes((prev) => prev.filter((b) => b.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setAddMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ── Notify parent of box class changes (for live schedule) ───────────────────
  useEffect(() => {
    onBoxesChange?.(editBoxes.map((b) => b.cls));
  }, [editBoxes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom helpers ───────────────────────────────────────────────────────────────
  const zoomToPoint = useCallback(
    (point: { x: number; y: number }, newScale: number) => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
      const mousePointTo = {
        x: (point.x - stageOffset.x) / stageScale,
        y: (point.y - stageOffset.y) / stageScale,
      };
      setStageScale(clamped);
      setStageOffset({
        x: point.x - mousePointTo.x * clamped,
        y: point.y - mousePointTo.y * clamped,
      });
    },
    [stageOffset, stageScale]
  );

  const fitToView = useCallback(() => {
    setStageScale(1);
    setStageOffset({ x: 0, y: 0 });
  }, []);

  // Convert stage-container coords → layer coords
  const toLayer = useCallback(
    (pos: { x: number; y: number }) => ({
      x: (pos.x - stageOffset.x) / stageScale,
      y: (pos.y - stageOffset.y) / stageScale,
    }),
    [stageOffset, stageScale]
  );

  // ── Scroll to zoom ────────────────────────────────────────────────────────────
  const onStageWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const direction = e.evt.deltaY < 0 ? 1 : -1;
    zoomToPoint(pointer, direction > 0 ? stageScale * ZOOM_FACTOR : stageScale / ZOOM_FACTOR);
  };

  // ── Stage mouse handlers ───────────────────────────────────────────────────────
  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // bgImage has listening={false}, so clicks on it bubble to the stage
    const isBackground = e.target === e.target.getStage();

    if (addMode) {
      if (!isBackground) return;
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const lp = toLayer(pos);
      drawStartRef.current = lp;
      setDrawRect({ x: lp.x, y: lp.y, w: 0, h: 0 });
      return;
    }

    if (isBackground) {
      setSelectedId(null);
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      panStartRef.current = { px: pos.x, py: pos.y, ox: stageOffset.x, oy: stageOffset.y };
      setIsPanning(true);
    }
  };

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (addMode && drawStartRef.current) {
      const lp = toLayer(pos);
      const start = drawStartRef.current;
      setDrawRect({
        x: Math.min(start.x, lp.x),
        y: Math.min(start.y, lp.y),
        w: Math.abs(lp.x - start.x),
        h: Math.abs(lp.y - start.y),
      });
      return;
    }

    if (isPanning && panStartRef.current) {
      const { px, py, ox, oy } = panStartRef.current;
      setStageOffset({ x: ox + (pos.x - px), y: oy + (pos.y - py) });
    }
  };

  const onStageMouseUp = () => {
    if (addMode && drawRect) {
      const minSize = 8 / stageScale;
      if (drawRect.w > minSize && drawRect.h > minSize) {
        const id = genId();
        setEditBoxes((prev) => [
          ...prev,
          {
            id,
            cls: addClass,
            nx: drawRect.x / containerWidth,
            ny: drawRect.y / canvasHeight,
            nw: drawRect.w / containerWidth,
            nh: drawRect.h / canvasHeight,
          },
        ]);
        setSelectedId(id);
        setAddMode(false);
      }
      setDrawRect(null);
      drawStartRef.current = null;
    }

    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  };

  // ── Box mutation handlers ──────────────────────────────────────────────────────
  const handleDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    setEditBoxes((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, nx: node.x() / containerWidth, ny: node.y() / canvasHeight }
          : b
      )
    );
  };

  const handleTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Rect;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    setEditBoxes((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              nx: node.x() / containerWidth,
              ny: node.y() / canvasHeight,
              nw: (node.width() * sx) / containerWidth,
              nh: (node.height() * sy) / canvasHeight,
            }
          : b
      )
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setEditBoxes((prev) => prev.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  };

  const changeSelectedClass = (cls: string) => {
    if (!selectedId) return;
    setEditBoxes((prev) => prev.map((b) => (b.id === selectedId ? { ...b, cls } : b)));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (editBoxes.length === 0) {
      setEmptyWarning(true);
      setTimeout(() => setEmptyWarning(false), 3000);
      return;
    }
    onSubmit(
      editBoxes.map((b) => ({
        class_id: CLASS_IDS[b.cls] ?? 0,
        x_center: b.nx + b.nw / 2,
        y_center: b.ny + b.nh / 2,
        width: b.nw,
        height: b.nh,
      }))
    );
  };

  // ── Floating panel position ────────────────────────────────────────────────────
  const selectedBox = editBoxes.find((b) => b.id === selectedId);
  const stageH = isFullscreen ? containerHeight : canvasHeight;

  const panelLeft = selectedBox
    ? Math.max(0, Math.min(selectedBox.nx * containerWidth * stageScale + stageOffset.x, containerWidth - 240))
    : 0;
  const panelTop = selectedBox
    ? Math.max(4, Math.min(
        selectedBox.ny * canvasHeight * stageScale + stageOffset.y - 52,
        stageH - 52
      ))
    : 0;

  // ── Cursor ─────────────────────────────────────────────────────────────────────
  const cursor = addMode ? "crosshair" : isPanning ? "grabbing" : "grab";

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-white flex flex-col" : "space-y-3"}>

      {/* ── Toolbar ── */}
      <div className={`flex flex-wrap items-center gap-2 ${isFullscreen ? "px-4 pt-3 pb-2 border-b border-gray-200 shrink-0" : ""}`}>
        <button
          onClick={() => { setAddMode((m) => !m); setSelectedId(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
            addMode
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          + Add door
        </button>

        {addMode && (
          <>
            <select
              value={addClass}
              onChange={(e) => setAddClass(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CLASS_LIST.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
            <span className="text-xs text-blue-600">Click and drag on the plan to draw a box</span>
          </>
        )}

        {/* Zoom / fullscreen controls */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => zoomToPoint({ x: containerWidth / 2, y: stageH / 2 }, stageScale * ZOOM_FACTOR)}
            title="Zoom in (scroll up)"
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => zoomToPoint({ x: containerWidth / 2, y: stageH / 2 }, stageScale / ZOOM_FACTOR)}
            title="Zoom out (scroll down)"
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fitToView}
            title="Reset zoom"
            className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors tabular-nums"
          >
            {Math.round(stageScale * 100)}%
          </button>
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className={`relative w-full select-none overflow-hidden bg-gray-100 ${
          isFullscreen ? "flex-1" : "rounded-xl border border-gray-200"
        }`}
        style={!isFullscreen ? { height: canvasHeight } : undefined}
      >
        {containerWidth > 0 && (
          <Stage
            ref={stageRef}
            width={containerWidth}
            height={stageH}
            x={stageOffset.x}
            y={stageOffset.y}
            scaleX={stageScale}
            scaleY={stageScale}
            onWheel={onStageWheel}
            onMouseDown={onStageMouseDown}
            onMouseMove={onStageMouseMove}
            onMouseUp={onStageMouseUp}
            style={{ cursor, display: "block" }}
          >
            <Layer>
              {/* Background image */}
              {bgImage && (
                <KonvaImage
                  image={bgImage}
                  x={0}
                  y={0}
                  width={containerWidth}
                  height={canvasHeight}
                  listening={false}
                />
              )}

              {/* Bounding boxes */}
              {editBoxes.map((box) => {
                const x = box.nx * containerWidth;
                const y = box.ny * canvasHeight;
                const w = box.nw * containerWidth;
                const h = box.nh * canvasHeight;
                const color = CLASS_COLORS[box.cls] ?? "#6B7280";
                const isSelected = selectedId === box.id;
                const label = SHORT_LABELS[box.cls] ?? box.cls;
                // Scale-invariant stroke width (always ~1.5px visual)
                const sw = (isSelected ? 2 : 1.5) / stageScale;
                // Scale-invariant label font/pill (always ~10px visual)
                const fs = 10 / stageScale;
                const pillH = 16 / stageScale;
                const pillPad = 4 / stageScale;

                return (
                  <Group key={box.id}>
                    <Rect
                      id={box.id}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill={isSelected ? color + "38" : color + "18"}
                      stroke={color}
                      strokeWidth={sw}
                      draggable={!addMode}
                      onClick={() => { if (!addMode) setSelectedId(box.id); }}
                      onTap={() => { if (!addMode) setSelectedId(box.id); }}
                      onDragEnd={(e) => handleDragEnd(box.id, e)}
                      onTransformEnd={(e) => handleTransformEnd(box.id, e)}
                    />
                    {/* Label pill — scale-invariant */}
                    <Rect
                      x={x + pillPad}
                      y={y + pillPad}
                      width={label.length * fs * 0.58 + pillPad * 2}
                      height={pillH}
                      fill={color}
                      cornerRadius={3 / stageScale}
                      listening={false}
                    />
                    <Text
                      x={x + pillPad * 2}
                      y={y + pillPad + (pillH - fs) / 2}
                      text={label}
                      fontSize={fs}
                      fill="white"
                      fontStyle="bold"
                      listening={false}
                    />
                  </Group>
                );
              })}

              {/* Draw preview */}
              {drawRect && drawRect.w > 0 && drawRect.h > 0 && (
                <Rect
                  x={drawRect.x}
                  y={drawRect.y}
                  width={drawRect.w}
                  height={drawRect.h}
                  fill={(CLASS_COLORS[addClass] ?? "#6B7280") + "20"}
                  stroke={CLASS_COLORS[addClass] ?? "#6B7280"}
                  strokeWidth={1.5 / stageScale}
                  dash={[5 / stageScale, 4 / stageScale]}
                  listening={false}
                />
              )}

              {/* Transformer — scale-invariant handles */}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                keepRatio={false}
                anchorSize={8 / stageScale}
                anchorStrokeWidth={1.5 / stageScale}
                borderStrokeWidth={1.5 / stageScale}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 10 || newBox.height < 10) return oldBox;
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        )}

        {/* Floating edit panel for selected box */}
        {selectedBox && (
          <div
            className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex items-center gap-2 pointer-events-auto"
            style={{ left: panelLeft, top: panelTop, minWidth: 220 }}
          >
            <select
              value={selectedBox.cls}
              onChange={(e) => changeSelectedClass(e.target.value)}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {CLASS_LIST.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
            <button
              onClick={deleteSelected}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded hover:bg-red-50 transition-colors whitespace-nowrap"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className={`flex items-center justify-between gap-4 ${isFullscreen ? "px-4 pb-3 shrink-0" : ""}`}>
        <p className="text-xs text-gray-400">
          {editBoxes.length} box{editBoxes.length !== 1 ? "es" : ""} ·{" "}
          scroll to zoom · drag background to pan · click box to edit · <kbd className="font-mono">Del</kbd> to remove
        </p>
        <div className="flex items-center gap-3">
          {emptyWarning && (
            <span className="text-xs text-amber-600 font-medium">
              Add at least one box before submitting.
            </span>
          )}
          <button
            onClick={handleSubmit}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            Confirm & Submit Corrections
          </button>
        </div>
      </div>
    </div>
  );
}
