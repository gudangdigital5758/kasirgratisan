import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Download, Share2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { isNativePlatform, printRawNativeBluetooth, getDailyReportESCPOSData, type DailyReportPrintData } from '@/lib/printer';

interface DailyReportReceiptProps {
  open: boolean;
  onClose: () => void;
  data: DailyReportPrintData;
}

export default function DailyReportReceipt({ open, onClose, data }: DailyReportReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [printing, setPrinting] = useState(false);

  const captureReceipt = async (): Promise<HTMLCanvasElement | null> => {
    if (!receiptRef.current) return null;
    setGenerating(true);
    try {
      const canvas = await html2canvas(receiptRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      return canvas;
    } catch {
      toast.error('Gagal membuat gambar laporan');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    const canvas = await captureReceipt();
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `laporan-closing-${data.dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('Laporan berhasil diunduh');
  };

  const handleShare = async () => {
    const canvas = await captureReceipt();
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      if (navigator.share) {
        const file = new File([blob], `laporan-closing-${data.dateStr}.png`, { type: 'image/png' });
        await navigator.share({
          title: `Laporan Closing ${data.dateStr}`,
          text: `Laporan Closing dari ${data.storeSettings?.storeName || 'Toko'}`,
          files: [file],
        });
      } else {
        // Fallback: open WhatsApp with text
        const text = encodeURIComponent(
          `*DAILY SALES REPORT - ${data.storeSettings?.storeName || 'Toko'}*\n` +
          `Tanggal: ${data.dateStr}\n` +
          `Periode: ${data.periodStr}\n\n` +
          `*PENJUALAN*\n` +
          `Gross Sales: Rp ${data.grossSales.toLocaleString('id-ID')}\n` +
          `Discount: Rp ${data.discount.toLocaleString('id-ID')}\n` +
          `Net Sales: Rp ${data.netSales.toLocaleString('id-ID')}\n\n` +
          `*RINGKASAN*\n` +
          `Transaksi: ${data.txCount}\n` +
          `Item Terjual: ${data.itemCount}`
        );
        window.open(`https://wa.me/?text=${text}`, '_blank');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Gagal membagikan struk');
      }
    }
  };

  const handleBluetoothPrint = async () => {
    setPrinting(true);
    try {
      const rawText = getDailyReportESCPOSData(data);

      if (isNativePlatform()) {
        await printRawNativeBluetooth(rawText, toast);
        return;
      }

      if (!('bluetooth' in navigator)) {
        toast.error('Bluetooth tidak tersedia di browser ini. Gunakan Chrome di Android.');
        return;
      }

      toast.info('Mencari printer Bluetooth...');
      // @ts-expect-error Web Bluetooth API is not fully typed in TypeScript
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
      const encoder = new TextEncoder();
      const payload = encoder.encode(rawText);
      
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        await characteristic.writeValue(chunk);
      }

      toast.success('Laporan berhasil dicetak!');
      await server.disconnect();
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Gagal mencetak. Pastikan printer Bluetooth menyala.');
      }
    } finally {
      setPrinting(false);
    }
  };

  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-xl p-4">
        <DialogHeader className="relative">
          <DialogTitle className="text-center text-base font-bold">Struk Laporan Closing</DialogTitle>
        </DialogHeader>

        {/* Receipt preview - this gets captured as image */}
        <div ref={receiptRef} className="bg-white text-black p-4 rounded-lg mx-auto border" style={{ width: '280px', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.4' }}>
          {/* Store Header */}
          <div className="text-center mb-2">
            {data.storeSettings?.logo && (
              <img src={data.storeSettings.logo} alt="Logo" className="w-12 h-12 object-contain mx-auto mb-1" />
            )}
            <p className="font-bold text-xs">{data.storeSettings?.storeName || 'Toko'}</p>
            {data.storeSettings?.address && <p className="text-[9px]">{data.storeSettings.address}</p>}
            {data.storeSettings?.phone && <p className="text-[9px]">{data.storeSettings.phone}</p>}
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Report Title */}
          <div className="text-center font-bold text-xs my-1">
            <p>DAILY SALES REPORT</p>
            <p>{data.dateStr}</p>
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Info */}
          <div className="text-[10px] space-y-0.5">
            <p className="font-bold">Periode:</p>
            <p>{data.periodStr}</p>
            <div className="flex justify-between mt-2">
              <span>Jumlah Transaksi:</span>
              <span className="font-bold">{data.txCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Jumlah Item:</span>
              <span className="font-bold">{data.itemCount}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Sales Section */}
          <p className="font-bold text-[10px] mb-1">PENJUALAN</p>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Gross Sales</span>
              <span>{rp(data.grossSales)}</span>
            </div>
            {data.discount > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Discount</span>
                <span>-{rp(data.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-dashed border-gray-300 pt-0.5 mt-0.5">
              <span>Net Sales</span>
              <span>{rp(data.netSales)}</span>
            </div>
          </div>

          {/* Expenses section */}
          {data.includeExpenses && data.expensesAmount !== undefined && data.expensesAmount > 0 && (
            <>
              <div className="border-t border-dashed border-gray-400 my-2" />
              <p className="font-bold text-[10px] mb-1">PENGELUARAN & LABA NETTO</p>
              <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span>Net Sales</span>
                  <span>{rp(data.netSales)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Expenses</span>
                  <span>-{rp(data.expensesAmount)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-dashed border-gray-300 pt-0.5 mt-0.5">
                  <span>Net Profit</span>
                  <span>{rp(data.netProfit || 0)}</span>
                </div>
              </div>
            </>
          )}

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Payments Section */}
          <p className="font-bold text-[10px] mb-1">PEMBAYARAN</p>
          <div className="space-y-0.5 text-[10px]">
            {data.paymentBreakdown.length === 0 ? (
              <p className="text-gray-500 italic">Belum ada pembayaran</p>
            ) : (
              data.paymentBreakdown.map((pm, i) => (
                <div key={i} className="flex justify-between">
                  <span>{pm.name}</span>
                  <span>{rp(pm.amount)}</span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Top Products Section */}
          <p className="font-bold text-[10px] mb-1">PRODUK TERLARIS</p>
          <div className="space-y-1 text-[10px]">
            {data.topProducts.length === 0 ? (
              <p className="text-gray-500 italic">Belum ada penjualan</p>
            ) : (
              data.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between items-start">
                  <span className="max-w-[200px] truncate">{i + 1}. {p.name}</span>
                  <span className="font-bold pl-1">{p.qty}</span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Footer */}
          <div className="text-center text-[9px] text-gray-500 space-y-0.5">
            <p>END OF REPORT</p>
            {data.cashierName && <p>Dicetak oleh: {data.cashierName}</p>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-2.5" onClick={handleDownload} disabled={generating || printing}>
            <Download className="w-4 h-4" />
            <span className="text-[9px]">Unduh</span>
          </Button>
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-2.5" onClick={handleShare} disabled={generating || printing}>
            <Share2 className="w-4 h-4" />
            <span className="text-[9px]">Bagikan</span>
          </Button>
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-2.5" onClick={handleBluetoothPrint} disabled={generating || printing}>
            <Printer className="w-4 h-4" />
            <span className="text-[9px]">Cetak</span>
          </Button>
        </div>

        <Button variant="secondary" className="w-full mt-2" onClick={onClose}>
          Selesai
        </Button>
      </DialogContent>
    </Dialog>
  );
}
