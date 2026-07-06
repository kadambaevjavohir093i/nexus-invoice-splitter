export interface InvoiceGroup {
  id: string;
  invoiceNumber: string;
  customer: string;
  vehicle: string;
  date: string;
  total: number;
  pages: number[]; // 0-indexed page numbers from original PDF
  filename: string;
  isSelected: boolean;
  isStatement: boolean;
  unitNumber?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  totalPages: number;
  bytes: Uint8Array;
  pagesText: string[];
  invoices: InvoiceGroup[];
}

export type FilenamePattern = 
  | 'number_customer_vehicle'  // INV-2675 - Gurman Trucking - 2025 FREIGHTLINER Cascadia.pdf
  | 'number_customer'          // INV-2675 - Gurman Trucking.pdf
  | 'customer_number'          // Gurman Trucking - INV-2675.pdf
  | 'number_date'              // INV-2675 - 2026-06-23.pdf
  | 'custom';                  // Custom pattern with variables

export interface AppState {
  status: 'idle' | 'parsing' | 'ready' | 'processing' | 'error';
  fileName: string;
  fileSize: number;
  totalPages: number;
  invoices: InvoiceGroup[];
  selectedPattern: FilenamePattern;
  customPatternText: string;
  errorMessage: string | null;
}
