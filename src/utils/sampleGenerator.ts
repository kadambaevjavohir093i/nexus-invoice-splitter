import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Generates a valid multi-page PDF document representing the statement
 * and invoices shown in the prompt OCR. This allows the application to be
 * fully testable offline with real document operations.
 */
export async function generateSampleInvoicePdf(): Promise<{ bytes: Uint8Array; name: string }> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- PAGE 1: Statement Summary ---
  const page1 = pdfDoc.addPage([612, 792]); // Standard Letter size
  
  // Header
  page1.drawText('Nexus Lane Chicago', { x: 50, y: 740, size: 14, font: fontBold, color: rgb(0.1, 0.15, 0.3) });
  page1.drawText('481 Northeast Industrial Drive · Aurora, IL 60505', { x: 50, y: 725, size: 9, font });
  page1.drawText('(872) 277-7707 · il@nexusfleet.us', { x: 50, y: 712, size: 9, font });

  page1.drawText('BILL TO', { x: 400, y: 740, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  page1.drawText('Gurman Trucking', { x: 400, y: 725, size: 12, font: fontBold });
  page1.drawText('billing@gurmanprime.com', { x: 400, y: 710, size: 10, font });
  page1.drawText('2020 East Algonquin Road, Schaumburg IL 60173', { x: 400, y: 697, size: 9, font });

  // Title block
  page1.drawText('Statement', { x: 50, y: 640, size: 24, font: fontBold, color: rgb(0.1, 0.15, 0.3) });
  page1.drawText('#ST-88C2E332', { x: 50, y: 620, size: 12, font });
  page1.drawText('Period: 3/31/2026 – 6/29/2026 · 7 invoices · 4 vehicles', { x: 50, y: 605, size: 10, font, color: rgb(0.4, 0.4, 0.4) });

  page1.drawText('Balance Due', { x: 450, y: 640, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  page1.drawText('$3977.80', { x: 450, y: 615, size: 22, font: fontBold, color: rgb(0.85, 0.1, 0.1) });

  // Table Headers
  page1.drawText('INV #', { x: 50, y: 560, size: 9, font: fontBold });
  page1.drawText('VEHICLE', { x: 120, y: 560, size: 9, font: fontBold });
  page1.drawText('DATE', { x: 340, y: 560, size: 9, font: fontBold });
  page1.drawText('TOTAL', { x: 420, y: 560, size: 9, font: fontBold });
  page1.drawText('PAID', { x: 480, y: 560, size: 9, font: fontBold });
  page1.drawText('BALANCE', { x: 530, y: 560, size: 9, font: fontBold });

  // Table Divider line
  page1.drawLine({
    start: { x: 50, y: 550 },
    end: { x: 570, y: 550 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8)
  });

  // Table Content Rows
  const tableRows = [
    { num: 'INV-2675', veh: '2025 FREIGHTLINER Cascadia (Unit: 1215)', date: '6/23/2026', total: '577.56', paid: '0.00', bal: '577.56' },
    { num: 'INV-2693', veh: '2025 Freightliner Cascadia (Unit: 1209)', date: '6/26/2026', total: '1372.76', paid: '0.00', bal: '1372.76' },
    { num: 'INV-2700', veh: '2026 VOLVO TRUCK VNL (4) (Unit: 1308)', date: '6/26/2026', total: '499.67', paid: '0.00', bal: '499.67' },
    { num: 'INV-2706', veh: '2024 WABASH VANS Dry Van (Unit: 5624451)', date: '6/29/2026', total: '275.96', paid: '0.00', bal: '275.96' },
    { num: 'INV-2708', veh: '2025 Freightliner Cascadia (Unit: 430009)', date: '6/29/2026', total: '642.18', paid: '0.00', bal: '642.18' },
    { num: 'INV-2710', veh: '2025 Freightliner Cascadia (Unit: 1219)', date: '6/29/2026', total: '110.00', paid: '0.00', bal: '110.00' },
    { num: 'INV-2720', veh: '2026 VOLVO TRUCK VNL (4) (Unit: 1316)', date: '6/30/2026', total: '499.67', paid: '0.00', bal: '499.67' }
  ];

  let currentY = 530;
  tableRows.forEach((row) => {
    page1.drawText(row.num, { x: 50, y: currentY, size: 9, font: fontBold, color: rgb(0.1, 0.3, 0.6) });
    page1.drawText(row.veh, { x: 120, y: currentY, size: 8, font });
    page1.drawText(row.date, { x: 340, y: currentY, size: 9, font });
    page1.drawText(`$${row.total}`, { x: 420, y: currentY, size: 9, font });
    page1.drawText(`$${row.paid}`, { x: 480, y: currentY, size: 9, font, color: rgb(0.2, 0.6, 0.2) });
    page1.drawText(`$${row.bal}`, { x: 530, y: currentY, size: 9, font: fontBold, color: rgb(0.8, 0.2, 0.2) });
    currentY -= 20;
  });

  // Footer for Page 1
  page1.drawLine({
    start: { x: 50, y: currentY + 10 },
    end: { x: 570, y: currentY + 10 },
    thickness: 1.5,
    color: rgb(0.1, 0.15, 0.3)
  });
  
  page1.drawText('TOTALS', { x: 120, y: currentY - 5, size: 9, font: fontBold });
  page1.drawText('$3977.80', { x: 420, y: currentY - 5, size: 9, font: fontBold });
  page1.drawText('$0.00', { x: 480, y: currentY - 5, size: 9, font: fontBold });
  page1.drawText('$3977.80', { x: 530, y: currentY - 5, size: 9, font: fontBold, color: rgb(0.8, 0.1, 0.1) });

  page1.drawText('Powered by BigShop AI · Page 1 of 8', { x: 230, y: 30, size: 8, font, color: rgb(0.6, 0.6, 0.6) });


  // --- PAGES 2-8: Individual Invoice Pages ---
  const invoiceDetails = [
    {
      num: 'INV-2675',
      date: '06/23/2026, 5:32 PM',
      veh: '2025 FREIGHTLINER Cascadia',
      vin: '3AKJHHDR5SSWA6179',
      unit: '1215',
      services: [
        { desc: 'PM (Service 1: BASIC FREIGHTLINER PM)', type: 'LABOR', qty: '1', price: '$110.00', total: '$110.00' },
        { desc: 'FUEL FILTER CASCADIA', type: 'PART', qty: '1', price: '$85.00', total: '$85.00' },
        { desc: 'OIL FILTER CASCADIA', type: 'PART', qty: '1', price: '$40.25', total: '$40.25' },
        { desc: 'WATER SEPARATOR', type: 'PART', qty: '1', price: '$41.18', total: '$41.18' },
        { desc: 'AIR FILTER (ENGINE)', type: 'PART', qty: '1', price: '$75.20', total: '$75.20' },
        { desc: '10W-30 CASTROL', type: 'MATL', qty: '11', price: '$17.30', total: '$190.30' }
      ],
      labor: '$110.00', parts: '$241.63', materials: '$190.30', subtotal: '$541.93', tax: '$35.63', grand: '$577.56'
    },
    {
      num: 'INV-2693',
      date: '06/26/2026, 9:10 AM',
      veh: '2025 Freightliner Cascadia',
      vin: '3AKJHHDR4SSWA6173',
      unit: '1209',
      services: [
        { desc: 'PM (Service 1: BASIC FREIGHTLINER PM)', type: 'LABOR', qty: '1', price: '$110.00', total: '$110.00' },
        { desc: 'FUEL FILTER CASCADIA', type: 'PART', qty: '1', price: '$85.00', total: '$85.00' },
        { desc: 'R&R LH BUMPER REINFORCEMENT (Service 2: BUMPER)', type: 'LABOR', qty: '1.5', price: '$110.00', total: '$165.00' },
        { desc: 'BUMPER REINF LH W/HOLE', type: 'PART', qty: '1', price: '$195.00', total: '$195.00' },
        { desc: 'INSTALL TIRES (Service 3: TIRES)', type: 'LABOR', qty: '2', price: '$35.00', total: '$70.00' },
        { desc: 'KINBLI DRIVE TIRE, 295/75R22.5 #KLD398', type: 'TIRE', qty: '1', price: '$312.50', total: '$312.50' }
      ],
      labor: '$345.00', parts: '$436.63', materials: '$190.30', subtotal: '$1,284.43', tax: '$78.33', grand: '$1,372.76'
    },
    {
      num: 'INV-2700',
      date: '06/26/2026, 1:23 PM',
      veh: '2026 VOLVO TRUCK VNL (4)',
      vin: '4V4BC9EH9TN715406',
      unit: '1308',
      services: [
        { desc: 'PM SERVICE (Service 1: PM SERVICE NEW VOLVO)', type: 'LABOR', qty: '1', price: '$110.00', total: '$110.00' },
        { desc: 'FUEL FILTER VOLVO', type: 'PART', qty: '1', price: '$40.00', total: '$40.00' },
        { desc: 'OIL FILTER VOLVO', type: 'PART', qty: '2', price: '$25.60', total: '$51.20' },
        { desc: 'WATER SEPARATOR VOLVO', type: 'PART', qty: '1', price: '$95.77', total: '$95.77' },
        { desc: '10W-30 CASTROL', type: 'MATL', qty: '10', price: '$17.30', total: '$173.00' }
      ],
      labor: '$110.00', parts: '$186.97', materials: '$173.00', subtotal: '$469.97', tax: '$29.70', grand: '$499.67'
    },
    {
      num: 'INV-2706',
      date: '06/29/2026, 8:40 AM',
      veh: '2024 WABASH VANS Dry Van',
      vin: '1JJV532D5RL373451',
      unit: '5624451',
      services: [
        { desc: 'DOT inspection (Service 1: TRL DOT)', type: 'LABOR', qty: '1', price: '$72.00', total: '$72.00' },
        { desc: 'R&R WHEEL SEAL', type: 'LABOR', qty: '1', price: '$165.00', total: '$165.00' },
        { desc: 'WHEEL SEAL # 370065A', type: 'PART', qty: '1', price: '$28.54', total: '$28.54' },
        { desc: 'HUB CAP GASKET LARGE', type: 'PART', qty: '1', price: '$7.45', total: '$7.45' }
      ],
      labor: '$237.00', parts: '$35.99', materials: '$0.00', subtotal: '$272.99', tax: '$2.97', grand: '$275.96'
    },
    {
      num: 'INV-2708',
      date: '06/29/2026, 8:44 AM',
      veh: '2025 Freightliner Cascadia',
      vin: 'N/A',
      unit: '430009',
      services: [
        { desc: 'R&R RH BUMPER (Service 1: BUMPER)', type: 'LABOR', qty: '2', price: '$110.00', total: '$220.00' },
        { desc: 'BUMPER FASCIA RH W/FOG', type: 'PART', qty: '1', price: '$195.00', total: '$195.00' },
        { desc: 'BUMPER REINF RH W/HOLE', type: 'PART', qty: '1', price: '$195.00', total: '$195.00' }
      ],
      labor: '$220.00', parts: '$390.00', materials: '$0.00', subtotal: '$610.00', tax: '$32.18', grand: '$642.18'
    },
    {
      num: 'INV-2710',
      date: '06/29/2026, 8:50 AM',
      veh: '2025 Freightliner Cascadia',
      vin: '3AKJHHDR6SSWD4170',
      unit: '1219',
      services: [
        { desc: 'INSTALL MOTIVE (Service 1: MOTIVE)', type: 'LABOR', qty: '1', price: '$110.00', total: '$110.00' }
      ],
      labor: '$110.00', parts: '$0.00', materials: '$0.00', subtotal: '$110.00', tax: '$0.00', grand: '$110.00'
    },
    {
      num: 'INV-2720',
      date: '06/30/2026, 8:13 AM',
      veh: '2026 VOLVO TRUCK VNL (4)',
      vin: '4V4BC9EH2TN713979',
      unit: '1316',
      services: [
        { desc: 'PM SERVICE (Service 1: PM SERVICE NEW VOLVO)', type: 'LABOR', qty: '1', price: '$110.00', total: '$110.00' },
        { desc: 'FUEL FILTER VOLVO', type: 'PART', qty: '1', price: '$40.00', total: '$40.00' },
        { desc: 'OIL FILTER VOLVO', type: 'PART', qty: '2', price: '$25.60', total: '$51.20' },
        { desc: 'WATER SEPARATOR VOLVO', type: 'PART', qty: '1', price: '$95.77', total: '$95.77' },
        { desc: '10W-30 CASTROL', type: 'MATL', qty: '10', price: '$17.30', total: '$173.00' }
      ],
      labor: '$110.00', parts: '$186.97', materials: '$173.00', subtotal: '$469.97', tax: '$29.70', grand: '$499.67'
    }
  ];

  invoiceDetails.forEach((inv, pageIdx) => {
    const page = pdfDoc.addPage([612, 792]);
    const pNum = pageIdx + 2;

    // Logo & Header Left
    page.drawText('NEXUS', { x: 50, y: 740, size: 14, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
    page.drawText('Nexus Lane Chicago', { x: 105, y: 740, size: 14, font: fontBold });
    page.drawText('481 Northeast Industrial Drive · Aurora, IL · 60505', { x: 50, y: 725, size: 8, font });
    page.drawText('(872) 277-7707 · il@nexusfleet.us · nexusfleet.us', { x: 50, y: 712, size: 8, font });

    // Logo & Header Right
    page.drawText('Invoice', { x: 450, y: 740, size: 22, font: fontBold, color: rgb(0.1, 0.6, 0.4) });
    page.drawText(inv.num, { x: 450, y: 720, size: 14, font: fontBold });
    page.drawText(inv.date, { x: 450, y: 705, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

    // Customer / Vehicle block background
    page.drawRectangle({
      x: 50,
      y: 640,
      width: 240,
      height: 50,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.9, 0.92, 0.95),
      borderWidth: 1
    });
    page.drawText('CUSTOMER', { x: 55, y: 678, size: 8, font: fontBold, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('Gurman Trucking', { x: 55, y: 662, size: 11, font: fontBold });
    page.drawText('billing@gurmanprime.com', { x: 55, y: 648, size: 9, font });

    page.drawRectangle({
      x: 320,
      y: 640,
      width: 250,
      height: 50,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.9, 0.92, 0.95),
      borderWidth: 1
    });
    page.drawText('VEHICLE', { x: 325, y: 678, size: 8, font: fontBold, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(inv.veh, { x: 325, y: 662, size: 10, font: fontBold });
    page.drawText(`VIN: ${inv.vin}  Unit #: ${inv.unit}`, { x: 325, y: 648, size: 8, font });

    // Line items Table Header
    page.drawRectangle({
      x: 50,
      y: 595,
      width: 520,
      height: 25,
      color: rgb(0.1, 0.15, 0.25)
    });
    page.drawText('Type', { x: 55, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Description', { x: 100, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Price', { x: 380, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('QTY', { x: 440, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('HRS', { x: 480, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Subtotal', { x: 520, y: 604, size: 9, font: fontBold, color: rgb(1, 1, 1) });

    // Render items
    let y = 575;
    inv.services.forEach((s) => {
      page.drawText(s.type, { x: 55, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(s.desc, { x: 100, y, size: 8, font });
      page.drawText(s.price, { x: 380, y, size: 8, font });
      page.drawText(s.qty, { x: 445, y, size: 8, font });
      page.drawText('-', { x: 485, y, size: 8, font });
      page.drawText(s.total, { x: 520, y, size: 8, font });
      
      // Draw sub-border
      page.drawLine({
        start: { x: 50, y: y - 5 },
        end: { x: 570, y: y - 5 },
        thickness: 0.5,
        color: rgb(0.9, 0.9, 0.9)
      });
      y -= 18;
    });

    // Summary block (Bottom Right)
    const summaryY = y - 10;
    page.drawText('Labor', { x: 400, y: summaryY, size: 9, font });
    page.drawText(inv.labor, { x: 520, y: summaryY, size: 9, font });

    page.drawText('Parts', { x: 400, y: summaryY - 15, size: 9, font });
    page.drawText(inv.parts, { x: 520, y: summaryY - 15, size: 9, font });

    page.drawText('Materials', { x: 400, y: summaryY - 30, size: 9, font });
    page.drawText(inv.materials, { x: 520, y: summaryY - 30, size: 9, font });

    page.drawText('Subtotal', { x: 400, y: summaryY - 45, size: 9, font: fontBold });
    page.drawText(inv.subtotal, { x: 520, y: summaryY - 45, size: 9, font: fontBold });

    page.drawText('Tax (8.25%)', { x: 400, y: summaryY - 60, size: 9, font });
    page.drawText(inv.tax, { x: 520, y: summaryY - 60, size: 9, font });

    page.drawLine({
      start: { x: 400, y: summaryY - 68 },
      end: { x: 570, y: summaryY - 68 },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2)
    });

    page.drawText('Grand Total', { x: 400, y: summaryY - 82, size: 10, font: fontBold });
    page.drawText(inv.grand, { x: 520, y: summaryY - 82, size: 10, font: fontBold });

    page.drawText('REMAINING BALANCE', { x: 400, y: summaryY - 100, size: 10, font: fontBold, color: rgb(0.1, 0.15, 0.3) });
    page.drawText(inv.grand, { x: 520, y: summaryY - 100, size: 10, font: fontBold, color: rgb(0.1, 0.15, 0.3) });

    // Terms note
    page.drawText('Thank you for your business! The work is complete and payment is due.', { x: 50, y: summaryY - 20, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('This shop charges a 3% credit card processing fee.', { x: 50, y: summaryY - 35, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

    // Footer
    page.drawText(`Powered by BigShop AI · Page ${pNum} of 8`, { x: 230, y: 30, size: 8, font, color: rgb(0.6, 0.6, 0.6) });
  });

  const bytes = await pdfDoc.save();
  return {
    bytes,
    name: 'Gurman_Trucking_Master_Invoices.pdf'
  };
}
