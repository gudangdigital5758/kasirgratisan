import { useEffect } from 'react';
import { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } from '@capawesome/capacitor-app-update';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { toast } from 'sonner';

export function useAppUpdate() {
  useEffect(() => {
    // Hanya jalankan di perangkat Android native
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    let listener: PluginListenerHandle | null = null;

    const checkUpdate = async () => {
      try {
        const info = await AppUpdate.getAppUpdateInfo();
        
        // Cek jika ada update baru dan flow fleksibel diizinkan
        if (info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE && info.flexibleUpdateAllowed) {
          
          // Dapatkan listener untuk memantau status download
          listener = await AppUpdate.addListener('onFlexibleUpdateStateChange', (state) => {
            if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
              // Notifikasi ke user saat download update selesai
              toast.info('Pembaruan Aplikasi Siap!', {
                description: 'Versi terbaru sudah diunduh. Silakan restart aplikasi untuk menerapkan pembaruan.',
                action: {
                  label: 'Restart',
                  onClick: async () => {
                    try {
                      await AppUpdate.completeFlexibleUpdate();
                    } catch (err) {
                      console.error("Gagal menerapkan update fleksibel:", err);
                      toast.error('Gagal memasang pembaruan. Silakan coba beberapa saat lagi.');
                    }
                  }
                },
                duration: Infinity, // Tetap muncul sampai user berinteraksi
              });
            }
          });

          // Mulai download di background (fleksibel)
          await AppUpdate.startFlexibleUpdate();
        }
      } catch (error) {
        console.warn("Gagal memeriksa update otomatis:", error);
      }
    };

    checkUpdate();

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, []);
}
