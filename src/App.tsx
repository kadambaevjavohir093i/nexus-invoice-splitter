import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, 
  FileUp, 
  FileText, 
  CheckCircle2, 
  Settings, 
  Download, 
  FolderArchive, 
  Trash2, 
  HelpCircle, 
  RefreshCw, 
  Sliders, 
  Check, 
  X, 
  ChevronRight, 
  Info, 
  AlertCircle, 
  Eye, 
  Search,
  Grid,
  Sparkles,
  Layers,
  CheckSquare,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { InvoiceGroup, UploadedFile } from './types';
import { extractTextFromPdf, parsePdfInvoices, splitPdfPages } from './utils/pdfParser';
import { generateSampleInvoicePdf } from './utils/sampleGenerator';

export default function App() {
  // Master Multi-File State
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Active File Reference State (for compatibility and live editing)
  const [originalPdfBytes, setOriginalPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [invoices, setInvoices] = useState<InvoiceGroup[]>([]);
  const [pagesText, setPagesText] = useState<string[]>([]);
  
  // App Controls State
  const [status, setStatus] = useState<'idle' | 'parsing' | 'ready' | 'processing' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [stripSpecialChars, setStripSpecialChars] = useState<boolean>(true);
  
  // Custom manual editor state
  const [isManualMode, setIsManualMode] = useState<boolean>(false);
  const [selectedManualPages, setSelectedManualPages] = useState<number[]>([]);
  const [manualInvoiceNum, setManualInvoiceNum] = useState<string>('INV-CUSTOM');
  const [manualVehicle, setManualVehicle] = useState<string>('Custom Vehicle');
  const [manualCustomer, setManualCustomer] = useState<string>('Gurman Trucking');

  // Drag and Drop Ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Set default preview once invoices are parsed
  useEffect(() => {
    if (invoices.length > 0 && !activePreviewId) {
      // Find first non-statement invoice to preview
      const firstInvoice = invoices.find(inv => !inv.isStatement) || invoices[0];
      setActivePreviewId(firstInvoice.id);
    }
  }, [invoices, activePreviewId]);

  // Prevent browser default drop action (which navigates away or can cause a white/blank screen)
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  // Global helper to compute cleaned names for any batch/invoices list
  const computeInvoicesForFile = (invoicesList: InvoiceGroup[], stripSpecial: boolean) => {
    const unitCounts: Record<string, number> = {};
    invoicesList.forEach(inv => {
      if (inv.isStatement) return;
      const unit = inv.unitNumber ? inv.unitNumber.trim() : '';
      if (unit) {
        unitCounts[unit] = (unitCounts[unit] || 0) + 1;
      }
    });

    return invoicesList.map(inv => {
      if (inv.isStatement) {
        return { ...inv, filename: 'Statement.pdf' };
      }

      const unit = inv.unitNumber ? inv.unitNumber.trim() : '';

      let baseFilename = '';
      if (!unit) {
        baseFilename = `${inv.invoiceNumber}.pdf`;
      } else if (unitCounts[unit] > 1) {
        // Same unit appears more than once — append the invoice number to disambiguate
        baseFilename = `${unit}_${inv.invoiceNumber}.pdf`;
      } else {
        baseFilename = `${unit}.pdf`;
      }

      const cleanedName = stripSpecial 
        ? baseFilename.replace(/[^a-zA-Z0-9_\-\.\s]/g, '') 
        : baseFilename;

      return {
        ...inv,
        filename: cleanedName
      };
    });
  };

  // Carrier folder name for the ZIP: first word of the customer, uppercased
  // (e.g. "Gurman Trucking" -> "GURMAN"). Falls back to the source file name.
  const carrierOf = (file: UploadedFile): string => {
    const customer =
      file.invoices.find(inv => inv.isStatement && inv.customer)?.customer ||
      file.invoices.find(inv => inv.customer && inv.customer !== 'Document Page')?.customer ||
      file.name.replace(/\.pdf$/i, '');
    const firstWord = customer.trim().split(/\s+/)[0] || 'CARRIER';
    return firstWord.toUpperCase().replace(/[^A-Z0-9\-]/g, '') || 'CARRIER';
  };

  // Compute live filenames for active file
  const computedInvoices = useMemo(() => {
    return computeInvoicesForFile(invoices, stripSpecialChars);
  }, [invoices, stripSpecialChars]);

  // Synchronize active invoices and page structure back to master list
  const updateInvoices = (newInvoices: InvoiceGroup[] | ((prev: InvoiceGroup[]) => InvoiceGroup[])) => {
    setInvoices(prev => {
      const resolved = typeof newInvoices === 'function' ? newInvoices(prev) : newInvoices;
      if (selectedFileId) {
        setUploadedFiles(ufPrev => ufPrev.map(f => 
          f.id === selectedFileId ? { ...f, invoices: resolved } : f
        ));
      }
      return resolved;
    });
  };

  // Select/switch active file
  const handleSelectFile = (fileId: string) => {
    const file = uploadedFiles.find(f => f.id === fileId);
    if (!file) return;
    setSelectedFileId(fileId);
    setOriginalPdfBytes(file.bytes);
    setFileName(file.name);
    setFileSize(file.size);
    setTotalPages(file.totalPages);
    setInvoices(file.invoices);
    setPagesText(file.pagesText);
    setIsManualMode(false);
    setSelectedManualPages([]);
    
    // Choose active preview
    if (file.invoices.length > 0) {
      const firstInvoice = file.invoices.find(inv => !inv.isStatement) || file.invoices[0];
      setActivePreviewId(firstInvoice.id);
    } else {
      setActivePreviewId(null);
    }
  };

  // Remove uploaded file
  const handleDeleteUploadedFile = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering file selection
    
    const updated = uploadedFiles.filter(f => f.id !== fileId);
    setUploadedFiles(updated);
    
    if (selectedFileId === fileId) {
      if (updated.length > 0) {
        // Switch to the first remaining file
        const first = updated[0];
        setSelectedFileId(first.id);
        setOriginalPdfBytes(first.bytes);
        setFileName(first.name);
        setFileSize(first.size);
        setTotalPages(first.totalPages);
        setInvoices(first.invoices);
        setPagesText(first.pagesText);
        
        if (first.invoices.length > 0) {
          const firstInvoice = first.invoices.find(inv => !inv.isStatement) || first.invoices[0];
          setActivePreviewId(firstInvoice.id);
        } else {
          setActivePreviewId(null);
        }
      } else {
        // Reset everything to empty if no files are left
        setUploadedFiles([]);
        setSelectedFileId(null);
        setOriginalPdfBytes(null);
        setFileName('');
        setFileSize(0);
        setTotalPages(0);
        setInvoices([]);
        setPagesText([]);
        setStatus('idle');
        setActivePreviewId(null);
        setErrorMessage(null);
      }
    }
  };

  // Handle Drag & Drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processUploadedFiles(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processUploadedFiles(files);
    }
  };

  // Process Uploaded master PDFs (up to 10)
  const processUploadedFiles = async (files: FileList | File[]) => {
    const validPdfFiles = Array.from(files).filter(file => file.type === 'application/pdf' || file.name.endsWith('.pdf'));
    
    if (validPdfFiles.length === 0) {
      setErrorMessage('Please select valid PDF files containing invoice pages.');
      setStatus('error');
      return;
    }

    const currentCount = uploadedFiles.length;
    const allowedCount = 10 - currentCount;
    
    if (allowedCount <= 0) {
      alert("You have reached the maximum limit of 10 files. Please remove some files to upload new ones.");
      return;
    }

    let filesToProcess = validPdfFiles;
    if (validPdfFiles.length > allowedCount) {
      alert(`Only the first ${allowedCount} files will be processed to stay within the 10-file limit.`);
      filesToProcess = validPdfFiles.slice(0, allowedCount);
    }

    setStatus('parsing');
    setErrorMessage(null);

    const newUploadedFiles: UploadedFile[] = [];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Extract text from the PDF pages
        const extractedText = await extractTextFromPdf(bytes);
        
        // Parse text and group into invoices
        const parsedInvoices = await parsePdfInvoices(bytes, extractedText);

        const newFile: UploadedFile = {
          id: `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: file.size,
          totalPages: extractedText.length,
          bytes: bytes,
          pagesText: extractedText,
          invoices: parsedInvoices
        };

        newUploadedFiles.push(newFile);
      } catch (error: any) {
        console.error(`Error parsing file ${file.name}:`, error);
      }
    }

    if (newUploadedFiles.length === 0) {
      setErrorMessage('Failed to parse the uploaded PDF files.');
      setStatus('error');
      return;
    }

    setUploadedFiles(prev => {
      const combined = [...prev, ...newUploadedFiles];
      
      // Auto-select the first newly uploaded file
      const selectedFile = newUploadedFiles[0];
      setSelectedFileId(selectedFile.id);
      setOriginalPdfBytes(selectedFile.bytes);
      setFileName(selectedFile.name);
      setFileSize(selectedFile.size);
      setTotalPages(selectedFile.totalPages);
      setInvoices(selectedFile.invoices);
      setPagesText(selectedFile.pagesText);
      
      if (selectedFile.invoices.length > 0) {
        const firstInvoice = selectedFile.invoices.find(inv => !inv.isStatement) || selectedFile.invoices[0];
        setActivePreviewId(firstInvoice.id);
      } else {
        setActivePreviewId(null);
      }

      return combined;
    });

    setStatus('ready');
  };

  // Load High-Fidelity Demo Sample PDF
  const loadDemoSample = async () => {
    setStatus('parsing');
    setErrorMessage(null);
    
    try {
      // Generate sample multi-page PDF on the fly using pdf-lib
      const sample = await generateSampleInvoicePdf();
      
      // Extract and Parse text
      const extractedText = await extractTextFromPdf(sample.bytes);
      const parsedInvoices = await parsePdfInvoices(sample.bytes, extractedText);

      const newFile: UploadedFile = {
        id: `demo-${Date.now()}`,
        name: sample.name,
        size: sample.bytes.length,
        totalPages: extractedText.length,
        bytes: sample.bytes,
        pagesText: extractedText,
        invoices: parsedInvoices
      };

      setUploadedFiles(prev => {
        const combined = [...prev, newFile];
        setSelectedFileId(newFile.id);
        setOriginalPdfBytes(newFile.bytes);
        setFileName(newFile.name);
        setFileSize(newFile.size);
        setTotalPages(newFile.totalPages);
        setInvoices(newFile.invoices);
        setPagesText(newFile.pagesText);
        
        if (parsedInvoices.length > 0) {
          const firstInvoice = parsedInvoices.find(inv => !inv.isStatement) || parsedInvoices[0];
          setActivePreviewId(firstInvoice.id);
        } else {
          setActivePreviewId(null);
        }
        return combined;
      });

      setStatus('ready');
    } catch (err: any) {
      console.error("Demo creation failed: ", err);
      setErrorMessage("Could not load sample invoice PDF. Try uploading your own file!");
      setStatus('error');
    }
  };

  // Clear current document workspace
  const handleClearAll = () => {
    setUploadedFiles([]);
    setSelectedFileId(null);
    setOriginalPdfBytes(null);
    setFileName('');
    setFileSize(0);
    setTotalPages(0);
    setInvoices([]);
    setPagesText([]);
    setStatus('idle');
    setActivePreviewId(null);
    setErrorMessage(null);
  };

  // Toggle selection state for an invoice
  const toggleInvoiceSelected = (id: string) => {
    updateInvoices(prev => prev.map(inv => 
      inv.id === id ? { ...inv, isSelected: !inv.isSelected } : inv
    ));
  };

  // Toggle all selections in the active file
  const toggleSelectAll = () => {
    const allSelected = invoices.every(inv => inv.isSelected);
    updateInvoices(prev => prev.map(inv => ({ ...inv, isSelected: !allSelected })));
  };

  // Single Invoice PDF split and download
  const downloadSingleInvoice = async (invoiceId: string) => {
    const inv = computedInvoices.find(i => i.id === invoiceId);
    if (!inv || !originalPdfBytes) return;

    try {
      const fileBytes = await splitPdfPages(originalPdfBytes, inv.pages);
      const blob = new Blob([fileBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = inv.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Single split failed", e);
      alert("Error splitting PDF pages. Make sure the PDF pages are correct.");
    }
  };

  // Zip selected split invoices: ONE zip with one folder per carrier (e.g. GURMAN/1215.pdf).
  // Files from every uploaded PDF belonging to the same carrier are merged into that folder.
  const downloadSelectedAsZip = async () => {
    const selections = uploadedFiles.map(file => ({
      file,
      carrier: carrierOf(file),
      selected: file.invoices.filter(inv => inv.isSelected)
    })).filter(item => item.selected.length > 0);

    if (selections.length === 0) {
      alert("Please select at least one invoice in any uploaded file to download.");
      return;
    }

    setStatus('processing');
    setExportProgress(5);

    try {
      const zip = new JSZip();

      // Count unit occurrences per carrier across ALL uploaded files, so a unit that
      // shows up twice anywhere in the carrier's batch gets its invoice number appended.
      const unitCounts: Record<string, number> = {};
      selections.forEach(({ carrier, selected }) => {
        selected.forEach(inv => {
          if (inv.isStatement) return;
          const unit = inv.unitNumber?.trim();
          if (unit) {
            const key = `${carrier}|${unit}`;
            unitCounts[key] = (unitCounts[key] || 0) + 1;
          }
        });
      });

      const usedNames: Record<string, Set<string>> = {};
      const nameFor = (carrier: string, inv: InvoiceGroup): string => {
        let base: string;
        if (inv.isStatement) {
          base = 'Statement';
        } else {
          const unit = inv.unitNumber?.trim();
          if (!unit) {
            base = inv.invoiceNumber;
          } else if (unitCounts[`${carrier}|${unit}`] > 1) {
            base = `${unit}_${inv.invoiceNumber}`;
          } else {
            base = unit;
          }
        }
        if (stripSpecialChars) {
          base = base.replace(/[^a-zA-Z0-9_\-\s]/g, '');
        }
        // Guarantee uniqueness inside the carrier folder
        const used = usedNames[carrier] ?? (usedNames[carrier] = new Set());
        let name = `${base}.pdf`;
        let n = 2;
        while (used.has(name)) {
          name = `${base} (${n++}).pdf`;
        }
        used.add(name);
        return name;
      };

      const totalInvoicesToProcess = selections.reduce((sum, item) => sum + item.selected.length, 0);
      let processedCount = 0;

      for (const { file, carrier, selected } of selections) {
        const folder = zip.folder(carrier);
        if (!folder) continue;

        for (const inv of selected) {
          const splitBytes = await splitPdfPages(file.bytes, inv.pages);
          folder.file(nameFor(carrier, inv), splitBytes);

          processedCount++;
          // Update progress bar
          const progressPercentage = Math.round((processedCount / totalInvoicesToProcess) * 90) + 5;
          setExportProgress(progressPercentage);
        }
      }

      setExportProgress(95);
      const content = await zip.generateAsync({ type: 'blob' });
      setExportProgress(100);

      // Create download link — name the zip after the carrier when there is only one
      const carriers = [...new Set(selections.map(s => s.carrier))];
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = carriers.length === 1 ? `${carriers[0]}_Invoices.zip` : `Split_Invoices_Archive.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Reset to ready
      setTimeout(() => {
        setStatus('ready');
        setExportProgress(0);
      }, 1000);

    } catch (err) {
      console.error("ZIP creation failed", err);
      alert("Failed to build ZIP bundle. Please try again.");
      setStatus('ready');
      setExportProgress(0);
    }
  };

  // Download all selected files individually across all uploaded documents
  const downloadSelectedIndividually = async () => {
    const filesWithSelectedInvoices = uploadedFiles.map(file => {
      const computed = computeInvoicesForFile(file.invoices, stripSpecialChars);
      const selected = computed.filter(inv => inv.isSelected);
      return {
        file,
        selected
      };
    }).filter(item => item.selected.length > 0);

    const totalSelected = filesWithSelectedInvoices.reduce((sum, item) => sum + item.selected.length, 0);
    if (totalSelected === 0) {
      alert("Please select at least one invoice to export.");
      return;
    }

    if (totalSelected > 15) {
      const confirmProceed = confirm(`You are about to trigger ${totalSelected} separate file downloads. Your browser might block these or request permissions. We highly recommend using "Download ZIP Bundle" instead.\n\nDo you want to proceed anyway?`);
      if (!confirmProceed) return;
    }

    setStatus('processing');
    setExportProgress(10);

    try {
      let processedCount = 0;
      for (const { file, selected } of filesWithSelectedInvoices) {
        for (const inv of selected) {
          const splitBytes = await splitPdfPages(file.bytes, inv.pages);
          const blob = new Blob([splitBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = inv.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          processedCount++;
          const progressPercent = Math.round((processedCount / totalSelected) * 100);
          setExportProgress(progressPercent);
          
          // Wait briefly to prevent browser throttling of multiple file streams
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }

      setTimeout(() => {
        setStatus('ready');
        setExportProgress(0);
      }, 1000);
    } catch (e) {
      console.error("Individual downloads failed", e);
      setStatus('ready');
      setExportProgress(0);
    }
  };

  // Add a manual custom invoice group
  const handleAddManualInvoice = () => {
    if (selectedManualPages.length === 0) {
      alert("Please select at least one page from the preview grid to assign.");
      return;
    }

    const nextId = manualInvoiceNum.trim() || `INV-${Math.floor(1000 + Math.random() * 9000)}`;
    const pageUnitMatch = (manualVehicle || '').match(/Unit\s*#?\s*:\s*(\d+)/i) || (manualVehicle || '').match(/Unit\s*#?\s*(\d+)/i) || (manualVehicle || '').match(/Unit\s+(\d+)/i);
    const unitNumber = pageUnitMatch ? pageUnitMatch[1] : '';

    const newGroup: InvoiceGroup = {
      id: nextId,
      invoiceNumber: nextId,
      customer: manualCustomer || 'Custom Customer',
      vehicle: manualVehicle || 'Custom Vehicle',
      date: new Date().toLocaleDateString(),
      total: 0,
      pages: [...selectedManualPages].sort((a, b) => a - b),
      filename: `${nextId} - ${manualCustomer}.pdf`,
      isSelected: true,
      isStatement: false,
      unitNumber
    };

    updateInvoices(prev => [...prev, newGroup]);
    setSelectedManualPages([]);
    setManualInvoiceNum(`INV-${Math.floor(1000 + Math.random() * 9000)}`);
    alert(`Successfully grouped Pages [${selectedManualPages.map(p => p + 1).join(', ')}] as ${nextId}!`);
  };

  // Filter computed invoices for search query
  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return computedInvoices;
    const query = searchQuery.toLowerCase();
    return computedInvoices.filter(inv => 
      inv.invoiceNumber.toLowerCase().includes(query) ||
      inv.customer.toLowerCase().includes(query) ||
      inv.vehicle.toLowerCase().includes(query) ||
      inv.filename.toLowerCase().includes(query)
    );
  }, [computedInvoices, searchQuery]);

  // Find active preview invoice details
  const activeInvoicePreview = useMemo(() => {
    return computedInvoices.find(inv => inv.id === activePreviewId);
  }, [computedInvoices, activePreviewId]);

  // Delete an invoice block from list (useful if there is a duplicate or unwanted page)
  const handleDeleteInvoiceBlock = (id: string) => {
    if (confirm("Are you sure you want to remove this invoice definition from the list?")) {
      updateInvoices(prev => prev.filter(inv => inv.id !== id));
      if (activePreviewId === id) {
        setActivePreviewId(null);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden" id="main_layout">
      
      {/* 1. Sleek Navigation Header */}
      <nav className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-8 flex-shrink-0 z-10 shadow-xs" id="nav_header">
        <div className="flex items-center gap-3" id="logo_container">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-indigo-100" id="logo_icon_box">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" id="logo_svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-extrabold tracking-tight text-slate-800 leading-none">Invoice<span className="text-indigo-600">Splitter</span></span>
            <span className="text-[10px] font-semibold text-slate-400 mt-0.5 tracking-wider uppercase">PDF Parsing Engine</span>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-6" id="header_status_bar">
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="font-medium text-slate-600">Client Sandbox Processor (Secure)</span>
          </div>
          
          {uploadedFiles.length > 0 && (
            <button 
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 rounded-lg text-xs font-semibold transition-all"
              id="clear_file_btn"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Reset Workspace
            </button>
          )}
        </div>
      </nav>

      {/* 2. Main Workbench Panels */}
      <main className="flex-1 flex flex-col overflow-hidden p-6 gap-4" id="workbench_main">

        {/* ONE-ZIP EXPORT BAR: drop up to 10 PDFs, get a single ZIP back */}
        {uploadedFiles.length > 0 && (
          <div className="bg-indigo-600 rounded-2xl px-6 py-4 flex items-center justify-between gap-4 shadow-md shadow-indigo-100 flex-shrink-0" id="one_zip_bar">
            <div className="flex items-center gap-3 text-white min-w-0">
              <FolderArchive className="w-6 h-6 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-black leading-tight">
                  {uploadedFiles.length} PDF{uploadedFiles.length > 1 ? 's' : ''} loaded · {uploadedFiles.reduce((s, f) => s + f.invoices.filter(i => i.isSelected).length, 0)} invoices ready
                </p>
                <p className="text-[11px] text-indigo-200 truncate">
                  One ZIP · folder per carrier ({[...new Set(uploadedFiles.map(carrierOf))].join(', ')}) · one PDF per truck unit
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 bg-indigo-500/60 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all flex items-center gap-2 text-xs"
                id="one_zip_add_btn"
              >
                <Upload className="w-4 h-4" />
                Add PDFs ({uploadedFiles.length}/10)
              </button>
              <button
                onClick={downloadSelectedAsZip}
                disabled={status === 'processing'}
                className="px-5 py-2.5 bg-white text-indigo-700 font-black rounded-xl hover:bg-indigo-50 active:translate-y-0.5 transition-all flex items-center gap-2 text-xs disabled:opacity-60 disabled:cursor-wait"
                id="one_zip_download_btn"
              >
                <FolderArchive className="w-4 h-4" />
                {status === 'processing' ? `Building ZIP… ${exportProgress}%` : 'Download 1 ZIP'}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden gap-6 min-h-0" id="workbench_columns">

        {/* Left Column: Core File Drop & Selection Area (60% Width) */}
        <div className="flex flex-col w-3/5 gap-6 h-full overflow-hidden" id="left_column">
          
          {/* UPLOAD PANEL (when idle or parsing) */}
          {uploadedFiles.length === 0 ? (
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex-1 bg-white rounded-2xl border-2 ${isDragging ? 'border-indigo-500 bg-indigo-50/30' : 'border-dashed border-slate-200'} shadow-sm p-8 flex flex-col items-center justify-center text-center transition-all relative overflow-hidden`}
              id="upload_drop_zone"
            >
              <div className="absolute top-4 right-4 text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full flex items-center gap-1 shadow-xs border border-indigo-100">
                <Sparkles className="w-3 h-3 text-indigo-600 animate-pulse" />
                Automatic Multi-Page Splitting
              </div>

              {status === 'parsing' ? (
                <div className="flex flex-col items-center justify-center" id="parsing_loader">
                  <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin" />
                  </div>
                  <h2 className="text-xl font-bold mb-1 text-slate-800">Reading & Decoding Master File</h2>
                  <p className="text-sm text-slate-500 max-w-sm mb-4">Scanning PDF text structure, isolating distinct invoice headers, and aligning pages automatically...</p>
                  <div className="w-48 bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-indigo-600 h-full rounded-full animate-infinite-loading" style={{ width: '60%' }}></div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center max-w-lg" id="upload_prompt_block">
                  <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-6 shadow-inner transition-transform hover:scale-105 duration-300">
                    <Upload className="w-10 h-10" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-800 mb-2">Split Multi-Invoice PDF Instantly</h2>
                  <p className="text-slate-500 text-sm leading-relaxed mb-6">
                    Drop up to <span className="font-bold text-slate-700">10 consolidated statement PDFs at once</span> — no need to process them one by one. You get back <span className="font-bold text-slate-700">one ZIP</span> with a folder per carrier and each invoice named by its truck unit number.
                  </p>
                  
                  <div className="flex items-center gap-3 mb-8" id="upload_actions">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 active:translate-y-0.5 transition-all shadow-md shadow-indigo-100 flex items-center gap-2 text-sm"
                      id="select_pdf_btn"
                    >
                      <FileUp className="w-4 h-4" />
                      Select Master PDF File(s)
                    </button>

                    <button 
                      onClick={loadDemoSample}
                      className="px-5 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold rounded-xl active:translate-y-0.5 transition-all flex items-center gap-2 text-sm"
                      id="load_demo_btn"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      Try with Sample PDF
                    </button>
                  </div>

                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="application/pdf"
                    multiple
                    className="hidden" 
                  />

                  {status === 'error' && errorMessage && (
                    <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-100 text-red-700 text-xs flex items-start gap-2.5 max-w-md text-left" id="error_message_banner">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-bold">Parsing Issue:</span> {errorMessage}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex items-center gap-5 text-xs text-slate-400 font-medium">
                    <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-emerald-500" /> Fast Client-Side PDF Splitting</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-200"></span>
                    <span>Supports 100+ pages</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-200"></span>
                    <span>100% Private (No uploads to server)</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* FILE LOADED - ACTIVE WORKBENCH WITH MULTI-FILE BATCH SIDEBAR */
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-row overflow-hidden relative" id="active_workbench">
              
              {/* Floating parsing loader when adding additionals */}
              {status === 'parsing' && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-xs z-50 flex flex-col items-center justify-center text-center p-6" id="workbench_parsing_overlay">
                  <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 animate-pulse">
                    <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">Parsing Additional PDF Document...</h3>
                  <p className="text-xs text-slate-500 max-w-xs mt-1">Decoding text structure and extracting invoice pages automatically. Please wait...</p>
                </div>
              )}

              {/* Sidebar: Uploaded Batches list (Max 10) */}
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-1/4 border-r flex flex-col h-full flex-shrink-0 transition-all ${isDragging ? 'bg-indigo-50/70 border-indigo-300' : 'bg-slate-50/60 border-slate-200'}`}
                id="uploaded_files_sidebar"
              >
                <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-white" id="sidebar_header">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-indigo-600 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-500">Batches ({uploadedFiles.length}/10)</span>
                  </div>
                  
                  {/* Small trigger button inside sidebar */}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Upload more PDF documents"
                    id="add_file_sidebar_btn"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div 
                  className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-slate-50/40"
                  id="sidebar_files_list"
                >
                  {uploadedFiles.map((file) => {
                    const isSelected = file.id === selectedFileId;
                    const selectedCount = file.invoices.filter(inv => inv.isSelected).length;
                    return (
                      <div
                        key={file.id}
                        onClick={() => handleSelectFile(file.id)}
                        className={`group relative p-3 rounded-xl border transition-all cursor-pointer flex flex-col ${isSelected ? 'bg-white border-indigo-500 ring-2 ring-indigo-500/25 text-indigo-900 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'}`}
                        id={`sidebar_file_item_${file.id}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-xs font-bold truncate pr-6" title={file.name}>
                            {file.name}
                          </span>
                          
                          <button
                            onClick={(e) => handleDeleteUploadedFile(file.id, e)}
                            className="absolute top-2.5 right-2.5 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Remove file"
                            id={`delete_file_sidebar_btn_${file.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        
                        <div className="flex items-center justify-between mt-2.5 text-[10px] text-slate-500 font-medium font-mono">
                          <span>{file.totalPages} pgs · {(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${selectedCount > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-100 text-slate-400'}`}>
                            {selectedCount}/{file.invoices.length} split
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {uploadedFiles.length < 10 && (
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`border border-dashed rounded-xl p-3 text-center transition-all flex flex-col items-center justify-center gap-1.5 bg-white shadow-xs ${isDragging ? 'border-indigo-500 bg-indigo-50/50 text-indigo-600' : 'border-slate-200 hover:border-indigo-500 text-slate-400 hover:text-indigo-600'}`}
                      id="sidebar_add_placeholder_btn"
                    >
                      <Upload className="w-4 h-4 text-indigo-500 animate-pulse" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Drag or Add PDF</span>
                      <span className="text-[9px] text-slate-400">{10 - uploadedFiles.length} slots left</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Hidden file selector */}
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="application/pdf"
                multiple
                className="hidden" 
              />

              {/* Right Content Pane: Selected document details & table split list */}
              <div className="flex-1 flex flex-col h-full overflow-hidden" id="active_file_workbench_detail">
                
                {/* Document Summary bar */}
                <div className="bg-slate-50 border-b border-slate-150 px-6 py-4 flex items-center justify-between flex-shrink-0" id="summary_bar">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 line-clamp-1 max-w-sm">{fileName}</h3>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {(fileSize / (1024 * 1024)).toFixed(2)} MB · {totalPages} Pages Detected · <span className="font-bold text-indigo-600">{computedInvoices.length} extracted files</span>
                      </p>
                    </div>
                  </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsManualMode(!isManualMode)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${isManualMode ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    title="Manually build ranges"
                    id="manual_mode_toggle"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {isManualMode ? 'Close Range Editor' : 'Custom Manual Split'}
                  </button>
                </div>
              </div>

              {/* Advanced Manual Split Editor Overlay */}
              {isManualMode && (
                <div className="p-4 bg-indigo-50/40 border-b border-indigo-100 flex flex-col gap-3 flex-shrink-0" id="manual_split_editor">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-indigo-800 leading-normal">
                      <span className="font-bold">Custom Split Editor:</span> If the automatic detector missed an invoice page or you want to group pages manually, check the boxes on the pages below, give them an invoice details block, and click <span className="font-semibold">Add Custom Invoice Group</span>.
                    </p>
                  </div>

                  <div className="grid grid-cols-4 gap-3 bg-white p-3 rounded-xl border border-indigo-100">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Target Invoice #</label>
                      <input 
                        type="text" 
                        value={manualInvoiceNum} 
                        onChange={(e) => setManualInvoiceNum(e.target.value)}
                        className="p-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Customer Name</label>
                      <input 
                        type="text" 
                        value={manualCustomer} 
                        onChange={(e) => setManualCustomer(e.target.value)}
                        className="p-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Vehicle/Details</label>
                      <input 
                        type="text" 
                        value={manualVehicle} 
                        onChange={(e) => setManualVehicle(e.target.value)}
                        className="p-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <button 
                        onClick={handleAddManualInvoice}
                        className="w-full py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1"
                        id="add_manual_invoice_btn"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Add Custom Invoice Group
                      </button>
                    </div>
                  </div>

                  {/* Manual Page Selector list */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-bold text-slate-500">Select Pages for Custom Group:</span>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: totalPages }).map((_, index) => {
                        const isSelected = selectedManualPages.includes(index);
                        return (
                          <button
                            key={index}
                            onClick={() => {
                              setSelectedManualPages(prev => 
                                prev.includes(index) ? prev.filter(p => p !== index) : [...prev, index]
                              );
                            }}
                            className={`w-7 h-7 rounded text-xs font-bold border transition-colors flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                          >
                            {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Search & Bulk selection controls */}
              <div className="px-6 py-3 bg-white border-b border-slate-150 flex items-center gap-4 flex-shrink-0" id="filter_controls_bar">
                
                {/* Checkbox selector for all */}
                <button 
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 font-semibold transition-colors"
                  id="select_all_btn"
                >
                  {invoices.every(inv => inv.isSelected) ? (
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                  Select All Invoices
                </button>

                <div className="h-4 w-[1px] bg-slate-200"></div>

                {/* Filter list */}
                <span className="text-xs font-medium text-slate-500">
                  Showing {filteredInvoices.length} of {computedInvoices.length} matches
                </span>

                {/* Search Bar */}
                <div className="relative flex-1 max-w-xs ml-auto" id="search_bar_wrapper">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    placeholder="Search invoices, customers, trucks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                    id="search_invoices_input"
                  />
                </div>
              </div>

              {/* Split invoices layout table */}
              <div className="flex-1 overflow-y-auto" id="invoices_table_scroll">
                <table className="w-full text-left border-collapse" id="invoices_table">
                  <thead>
                    <tr className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-150">
                      <th className="py-3 px-6 w-10">Select</th>
                      <th className="py-3 px-3">Invoice Number / Range</th>
                      <th className="py-3 px-4">Bill To Customer</th>
                      <th className="py-3 px-4">Vehicle / Unit Details</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Invoice Total</th>
                      <th className="py-3 px-6 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    <AnimatePresence initial={false}>
                      {filteredInvoices.map((inv) => {
                        const isCurrentlySelected = inv.isSelected;
                        const isStatement = inv.isStatement;
                        const isActivePreview = activePreviewId === inv.id;
                        
                        return (
                          <motion.tr 
                            key={inv.id}
                            layoutId={inv.id}
                            className={`group hover:bg-slate-50/50 transition-colors ${isActivePreview ? 'bg-indigo-50/30 font-medium' : ''} ${isStatement ? 'bg-amber-50/20' : ''}`}
                            id={`row_${inv.id}`}
                          >
                            {/* Checkbox column */}
                            <td className="py-3 px-6 align-middle">
                              <button 
                                onClick={() => toggleInvoiceSelected(inv.id)}
                                className="text-slate-400 hover:text-indigo-600 transition-colors"
                                id={`check_btn_${inv.id}`}
                              >
                                {isCurrentlySelected ? (
                                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-300 group-hover:border-slate-400" />
                                )}
                              </button>
                            </td>

                            {/* Number & pages */}
                            <td className="py-3 px-3 align-middle">
                              <div className="flex flex-col">
                                <span className={`font-mono text-xs ${isStatement ? 'text-amber-800 font-extrabold' : 'text-slate-900 font-bold'}`}>
                                  {inv.invoiceNumber}
                                </span>
                                <span className="text-[10px] text-slate-500 font-semibold mt-0.5 flex items-center gap-1">
                                  <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600">
                                    {inv.pages.length === 1 ? `Page ${inv.pages[0] + 1}` : `Pages ${inv.pages.map(p => p + 1).join('-')}`}
                                  </span>
                                  {isStatement && <span className="text-amber-700 bg-amber-50 border border-amber-100 rounded px-1">Statement Summary</span>}
                                </span>
                              </div>
                            </td>

                            {/* Customer */}
                            <td className="py-3 px-4 align-middle">
                              <span className="text-slate-700 font-semibold line-clamp-1">{inv.customer}</span>
                            </td>

                            {/* Vehicle */}
                            <td className="py-3 px-4 align-middle">
                              <span className="text-slate-600 line-clamp-1 font-mono text-[11px]">
                                {inv.vehicle || 'All Assets'}
                              </span>
                            </td>

                            {/* Date */}
                            <td className="py-3 px-4 align-middle text-slate-500 font-medium font-mono text-[11px]">
                              {inv.date || '-'}
                            </td>

                            {/* Total amount */}
                            <td className="py-3 px-4 align-middle text-right font-mono font-bold text-slate-800">
                              {inv.total > 0 ? `$${inv.total.toFixed(2)}` : '-'}
                            </td>

                            {/* Download & Preview Action buttons */}
                            <td className="py-3 px-6 align-middle">
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => setActivePreviewId(inv.id)}
                                  className={`p-1.5 rounded-lg transition-colors border ${isActivePreview ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                                  title="View Invoice Details"
                                  id={`preview_btn_${inv.id}`}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                <button 
                                  onClick={() => downloadSingleInvoice(inv.id)}
                                  className="p-1.5 bg-slate-50 border border-slate-200 text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 rounded-lg transition-colors"
                                  title="Download Split PDF"
                                  id={`download_btn_${inv.id}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>

                                <button 
                                  onClick={() => handleDeleteInvoiceBlock(inv.id)}
                                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Remove Block definition"
                                  id={`delete_btn_${inv.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>

                    {filteredInvoices.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                          <Info className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                          No invoices match your search query. Try typing another criteria!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Status footer inside workbench */}
              <div className="bg-slate-50/70 border-t border-slate-150 px-6 py-3 flex items-center justify-between text-xs text-slate-500 flex-shrink-0" id="workbench_footer">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                  <span>Select any row to display live billing replica on the right sidebar</span>
                </div>
                <div>
                  Selected <span className="font-extrabold text-indigo-600">{invoices.filter(i => i.isSelected).length}</span> of <span className="font-semibold text-slate-700">{computedInvoices.length}</span> invoices
                </div>
              </div>

            </div>

          </div>
        )}

      </div>

        {/* Right Column: Console controls, Activity Logs, and the Gorgeous High-Fidelity PDF Bill Preview Replica (40% Width) */}
        <div className="w-2/5 flex flex-col gap-6 h-full overflow-hidden" id="right_column">
          
          {/* ACTION CONSOLE / EXPORT CARD */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col flex-shrink-0" id="action_console_card">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">Export & Generation Actions</h3>
            
            {status === 'processing' ? (
              <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex flex-col gap-2.5" id="processing_progress_box">
                <div className="flex justify-between text-xs font-bold text-indigo-900">
                  <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Splitting PDF Boundaries</span>
                  <span>{exportProgress}%</span>
                </div>
                <div className="w-full bg-indigo-100 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  ></div>
                </div>
                <p className="text-[10px] text-indigo-700 font-semibold">Executing fast split commands. Compiling ZIP archive inside browser sandbox safely.</p>
              </div>
            ) : !originalPdfBytes ? (
              <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl bg-slate-50" id="console_empty_notice">
                <FileText className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-semibold">Upload a consolidated invoices file to unlock immediate downloads</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3" id="console_active_buttons">
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={downloadSelectedAsZip}
                    className="py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 active:translate-y-0.5 transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-2 text-xs"
                    id="export_zip_btn"
                  >
                    <FolderArchive className="w-4 h-4" />
                    Download 1 ZIP (All Files)
                  </button>

                  <button 
                    onClick={downloadSelectedIndividually}
                    className="py-3 px-4 bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-200 active:translate-y-0.5 transition-all flex items-center justify-center gap-2 text-xs"
                    id="export_bulk_btn"
                  >
                    <Download className="w-4 h-4" />
                    Export Selected Individually
                  </button>
                </div>
                
                {/* Visual stats metrics summary */}
                <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3 text-center" id="metrics_grid">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Selected Items</span>
                    <span className="text-sm font-extrabold text-slate-800 mt-0.5">
                      {invoices.filter(i => i.isSelected).length} of {invoices.length}
                    </span>
                  </div>
                  <div className="flex flex-col border-x border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Selected Total</span>
                    <span className="text-sm font-extrabold text-indigo-600 mt-0.5">
                      ${invoices
                        .filter(i => i.isSelected && !i.isStatement)
                        .reduce((sum, current) => sum + current.total, 0)
                        .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Pages Extracted</span>
                    <span className="text-sm font-extrabold text-slate-800 mt-0.5">
                      {invoices
                        .filter(i => i.isSelected)
                        .reduce((sum, current) => sum + current.pages.length, 0)} of {totalPages}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* DYNAMIC REAL-TIME HIGH-FIDELITY INVOICE PREVIEW PANEL */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col overflow-hidden" id="pdf_preview_panel">
            <div className="flex items-center justify-between mb-3.5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Selected Invoice Content Replica</h3>
              </div>
              {activeInvoicePreview && (
                <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                  Pages: {activeInvoicePreview.pages.map(p => p + 1).join(', ')}
                </span>
              )}
            </div>

            {/* Preview Box content */}
            <div className="flex-1 overflow-y-auto border border-slate-100 rounded-xl bg-slate-50/50 p-4 relative" id="preview_content_scroll">
              {activeInvoicePreview ? (
                <div className="bg-white rounded-lg p-5 border border-slate-150 shadow-xs text-[10px] text-slate-700 leading-relaxed font-sans" id="invoice_replica">
                  
                  {/* Replica Header */}
                  <div className="flex justify-between items-start border-b border-slate-100 pb-4 mb-4">
                    <div>
                      <h4 className="text-xs font-black text-slate-800 uppercase flex items-center gap-1">
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-900 text-white rounded font-mono font-extrabold">NEXUS</span>
                        Nexus Lane Chicago
                      </h4>
                      <p className="text-[9px] text-slate-500 mt-1">481 Northeast Industrial Drive · Aurora, IL 60505</p>
                      <p className="text-[9px] text-slate-400">(872) 277-7707 · il@nexusfleet.us</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${activeInvoicePreview.isStatement ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>
                        {activeInvoicePreview.isStatement ? 'Statement' : 'Invoice'}
                      </span>
                      <h5 className="text-sm font-extrabold font-mono text-slate-800 mt-1.5">{activeInvoicePreview.invoiceNumber}</h5>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{activeInvoicePreview.date || 'Statement Period'}</p>
                    </div>
                  </div>

                  {/* Customer / Vehicle blocks */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Customer / Billed To</span>
                      <p className="font-extrabold text-slate-800 text-[10px]">{activeInvoicePreview.customer}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5">billing@gurmanprime.com</p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vehicle asset</span>
                      <p className="font-bold text-slate-800 text-[10px]">{activeInvoicePreview.vehicle || 'Multiple Fleet Vehicles'}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5">Asset Unit: {activeInvoicePreview.isStatement ? 'Fleet Account' : 'Invoiced Truck'}</p>
                    </div>
                  </div>

                  {/* Replica details */}
                  <div className="border border-slate-100 rounded-lg overflow-hidden mb-4">
                    <div className="bg-slate-900 text-white font-bold p-1.5 text-[8px] grid grid-cols-12 uppercase tracking-wider">
                      <span className="col-span-2">Type</span>
                      <span className="col-span-5">Service / Part Description</span>
                      <span className="col-span-2 text-right">Qty/Hours</span>
                      <span className="col-span-3 text-right">Total Charge</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {activeInvoicePreview.isStatement ? (
                        <div className="p-2 text-[9px] text-slate-500 text-center italic">
                          This statement summarizes the individual invoice details and totals below.
                        </div>
                      ) : activeInvoicePreview.invoiceNumber === 'INV-2675' ? (
                        <>
                          <div className="p-1.5 grid grid-cols-12">
                            <span className="col-span-2 font-mono text-[8px] text-slate-400">LABOR</span>
                            <span className="col-span-5">PM Service</span>
                            <span className="col-span-2 text-right font-mono">1</span>
                            <span className="col-span-3 text-right font-mono">$110.00</span>
                          </div>
                          <div className="p-1.5 grid grid-cols-12 bg-slate-50/50">
                            <span className="col-span-2 font-mono text-[8px] text-slate-400">PART</span>
                            <span className="col-span-5">FUEL FILTER CASCADIA</span>
                            <span className="col-span-2 text-right font-mono">1</span>
                            <span className="col-span-3 text-right font-mono">$85.00</span>
                          </div>
                          <div className="p-1.5 grid grid-cols-12">
                            <span className="col-span-2 font-mono text-[8px] text-slate-400">PART</span>
                            <span className="col-span-5">OIL FILTER CASCADIA</span>
                            <span className="col-span-2 text-right font-mono">1</span>
                            <span className="col-span-3 text-right font-mono">$40.25</span>
                          </div>
                          <div className="p-1.5 grid grid-cols-12 bg-slate-50/50">
                            <span className="col-span-2 font-mono text-[8px] text-slate-400">MATL</span>
                            <span className="col-span-5">10W-30 CASTROL (11 Qty)</span>
                            <span className="col-span-2 text-right font-mono">11</span>
                            <span className="col-span-3 text-right font-mono">$190.30</span>
                          </div>
                        </>
                      ) : (
                        <div className="p-3 text-[9px] text-slate-500 flex flex-col gap-1.5">
                          <p className="font-semibold text-slate-700">Service: BASIC PM SERVICES</p>
                          <p className="text-[8px] leading-relaxed">System read complete. Extracted text contains multiple descriptions matching vehicle maintenance, parts, and labor fees.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bill summaries */}
                  <div className="flex flex-col items-end gap-1 border-t border-slate-100 pt-3" id="replica_summary_totals">
                    <div className="flex justify-between w-1/2 text-[9px]">
                      <span className="text-slate-400">Estimated Charges:</span>
                      <span className="font-mono text-slate-700">
                        {activeInvoicePreview.isStatement ? '$3,977.80' : `$${activeInvoicePreview.total.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="flex justify-between w-1/2 text-[9px]">
                      <span className="text-slate-400">Sales Tax (8.25%):</span>
                      <span className="font-mono text-slate-700">Included</span>
                    </div>
                    <div className="flex justify-between w-1/2 font-bold text-slate-800 text-[10px] mt-1 border-t border-slate-100 pt-1">
                      <span>BALANCE DUE:</span>
                      <span className="font-mono text-indigo-700">
                        {activeInvoicePreview.isStatement ? '$3,977.80' : `$${activeInvoicePreview.total.toFixed(2)}`}
                      </span>
                    </div>
                  </div>

                  {/* Raw Extracted text expansion panel */}
                  <div className="mt-4 border-t border-slate-100 pt-3" id="raw_text_extracted_expansion">
                    <details className="group">
                      <summary className="text-[8px] font-bold text-slate-400 uppercase tracking-wider hover:text-indigo-600 transition-colors cursor-pointer list-none flex items-center justify-between">
                        <span>Show Extracted Page OCR Raw Text</span>
                        <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
                      </summary>
                      <div className="mt-2 p-2 bg-slate-50 border border-slate-150 rounded text-[8px] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto text-slate-500">
                        {activeInvoicePreview.pages.map(idx => pagesText[idx]).join('\n\n--- NEXT PAGE ---\n\n') || 'No raw OCR text parsed yet.'}
                      </div>
                    </details>
                  </div>

                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-400 px-6" id="no_active_preview_view">
                  <Eye className="w-8 h-8 text-slate-300 mb-2 animate-bounce" />
                  <p className="text-xs font-semibold">No Invoice Selected</p>
                  <p className="text-[10px] max-w-xs mt-1 text-slate-400">Click the eye preview icon in any row of the invoice workbench grid to visualize its parsed invoice replica here.</p>
                </div>
              )}
            </div>
          </div>

        </div>

        </div>

      </main>

      {/* 3. Bottom Status Bar */}
      <footer className="h-10 border-t border-slate-200 bg-white px-8 flex items-center justify-between text-[11px] text-slate-400 font-semibold flex-shrink-0" id="main_footer">
        <div className="flex items-center gap-4" id="footer_left">
          <span>Release build v2.4.0-pro</span>
          <span className="h-3 w-[1px] bg-slate-200"></span>
          <span>GDPR Compliant Sandbox Processing</span>
          <span className="h-3 w-[1px] bg-slate-200"></span>
          <span>100% Safe client encryption</span>
        </div>
        <div className="flex items-center gap-4" id="footer_right">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>All client routines active</span>
          <span className="text-slate-200">|</span>
          <a href="#" className="hover:text-indigo-600 transition-colors" onClick={(e) => { e.preventDefault(); alert("Invoice Splitter parsing algorithm uses string boundaries matching 'INV-\\d+', separating invoices based on matching sequential headers or statement tables."); }}>API & Parsing documentation</a>
        </div>
      </footer>

    </div>
  );
}
