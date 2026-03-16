export interface BoundingBox {
  id: number;
  class: string;
  class_id: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CorrectedBox {
  class_id: number;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}
