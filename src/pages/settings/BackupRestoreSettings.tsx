import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Download, Upload, ChevronLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { exportBackupData } from '@/components/BackupReminder';
import { restoreFromBackupData } from '@/lib/backup';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';

export default function BackupRestoreSettings() {
  const { can } = useAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  if (!can('manage_backup')) {
    return <LockedPage title="Backup & Restore" permissionLabel="Kelola Backup" />;
  }

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!text.trim()) { toast.error('File kosong'); return; }
        const data = JSON.parse(text);
        await restoreFromBackupData(data);
        toast.success('Data berhasil di-restore!');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal membaca file');
      }
    };
    input.click();
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          Backup & Restore
        </h1>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={exportBackupData}>
            <Download className="w-4 h-4" /> Export Backup (JSON)
          </Button>
          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={handleImport}>
            <Upload className="w-4 h-4" /> Import / Restore Data
          </Button>
          {storeSettings?.lastBackupAt && (
            <p className="text-[10px] text-muted-foreground text-center">Terakhir backup: {new Date(storeSettings.lastBackupAt).toLocaleString('id-ID')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
