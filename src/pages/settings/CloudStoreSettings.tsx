import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  Store,
  Plus,
  Loader2,
  CheckCircle2,
  Pencil,
  Trash2,
  Link2,
  Package,
  ShoppingCart,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id as idLocale, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { useTranslation } from 'react-i18next';
import {
  fetchStores,
  createStore,
  renameStore,
  deleteStore,
  type CloudStore,
} from '@/lib/cloud-api';

const LOCALES: Record<string, Locale> = { id: idLocale, en: enUS, ms };

export default function CloudStoreSettings() {
  const { can } = useAuth();
  const { isLoggedIn, isSyncSubscribed, profile } = useCloudAuth();
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? idLocale;
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  // Batas jumlah toko sesuai paket sync aktif.
  const maxStores = profile?.user?.maxStores ?? profile?.syncSubscription?.plan?.maxStores ?? null;
  const isUnlimited = maxStores != null && maxStores >= 999999;

  const [stores, setStores] = useState<CloudStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeStoreId = storeSettings?.cloudStoreId ?? null;
  const atLimit = maxStores != null && !isUnlimited && stores.length >= maxStores;

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      setStores(await fetchStores());
    } catch {
      /* diabaikan */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && isSyncSubscribed) loadStores();
  }, [isLoggedIn, isSyncSubscribed, loadStores]);

  // Auto-show create form jika belum ada toko (dan masih dalam batas paket)
  useEffect(() => {
    if (!loading && stores.length === 0 && isSyncSubscribed && !atLimit) {
      setShowCreate(true);
      setNewName(storeSettings?.storeName ?? '');
    }
  }, [loading, stores.length, isSyncSubscribed, atLimit, storeSettings?.storeName]);

  if (!can('manage_backup')) {
    return <LockedPage title={t('cloudStore.locked.title')} permissionLabel={t('cloudStore.locked.permissionLabel')} />;
  }

  const handleBind = async (storeId: string) => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { cloudStoreId: storeId });
    toast.success(t('cloudStore.toast.bind'));
  };

  const handleUnbind = async () => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { cloudStoreId: null });
    toast.success(t('cloudStore.toast.unbind'));
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    if (atLimit) {
      toast.error(t('cloudStore.toast.atLimit'));
      return;
    }
    setBusy('create');
    try {
      const store = await createStore(name);
      setStores((prev) => [...prev, store]);
      setShowCreate(false);
      setNewName('');
      // Auto-bind jika ini toko pertama
      if (stores.length === 0 && storeSettings?.id) {
        await db.storeSettings.update(storeSettings.id, { cloudStoreId: store.id });
        toast.success(t('cloudStore.toast.createBound'));
      } else {
        toast.success(t('cloudStore.toast.create'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudStore.toast.createFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setBusy(`rename:${id}`);
    try {
      const updated = await renameStore(id, name);
      setStores((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
      setEditName('');
      toast.success(t('cloudStore.toast.rename'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudStore.toast.renameFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(`delete:${id}`);
    try {
      await deleteStore(id);
      setStores((prev) => prev.filter((s) => s.id !== id));
      setConfirmDeleteId(null);
      // Unbind jika toko yang dihapus adalah toko aktif
      if (activeStoreId === id && storeSettings?.id) {
        await db.storeSettings.update(storeSettings.id, { cloudStoreId: null });
      }
      toast.success(t('cloudStore.toast.delete'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudStore.toast.deleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  const activeStoreName = stores.find((s) => s.id === activeStoreId)?.name ?? t('cloudStore.loading');

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings/cloud">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Store className="w-5 h-5 text-primary" />
          {t('cloudStore.title')}
        </h1>
      </div>

      {!isLoggedIn || !isSyncSubscribed ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t('cloudStore.requiresSubscription')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Active store indicator */}
          {activeStoreId && (
            <Card className="border-0 shadow-sm border-l-4 border-l-primary">
              <CardContent className="p-3 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-muted-foreground">{t('cloudStore.activeDevice')}</p>
                  <p className="text-sm font-semibold truncate">
                    {activeStoreName}
                  </p>
                  <p className="text-[10px] text-success font-medium flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                    {t('cloudStore.syncActive')}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={handleUnbind}>
                  {t('cloudStore.disconnect')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Store list */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('cloudStore.storeList')}</p>
                  {maxStores != null && (
                    <p className="text-[10px] text-muted-foreground">
                      {t('cloudStore.used', {
                        used: stores.length,
                        max: isUnlimited ? t('cloudStore.unlimited') : `${maxStores} ${t('cloudStore.stats.stores')}`,
                      })}
                    </p>
                  )}
                </div>
                {!atLimit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs shrink-0"
                    onClick={() => { setShowCreate(true); setNewName(''); }}
                  >
                    <Plus className="w-3.5 h-3.5" /> {t('cloudStore.addButton')}
                  </Button>
                )}
              </div>

              {atLimit && (
                <div className="rounded-lg bg-warning/10 border border-warning/30 p-2.5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-foreground">{t('cloudStore.atLimit.title')}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      {t('cloudStore.atLimit.description', { max: maxStores })}
                    </p>
                    <Link to="/settings/cloud" className="inline-block mt-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-[11px]">{t('cloudStore.atLimit.upgrade')}</Button>
                    </Link>
                  </div>
                </div>
              )}

              {loading && stores.length === 0 ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : stores.length === 0 && !showCreate ? (
                <p className="text-xs text-muted-foreground text-center py-3">{t('cloudStore.noStore')}</p>
              ) : (
                <div className="space-y-2">
                  {stores.map((store) => {
                    const isBound = store.id === activeStoreId;
                    const isEditing = editingId === store.id;
                    const isDeleting = confirmDeleteId === store.id;
                    const counts = store._count;

                    return (
                      <div
                        key={store.id}
                        className={`rounded-xl border p-3 space-y-2 ${isBound ? 'border-primary/40 bg-primary/5' : ''}`}
                      >
                        {isEditing ? (
                          <div className="flex gap-2">
                            <Input
                              className="h-9 text-sm"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRename(store.id)}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              className="h-9"
                              disabled={!editName.trim() || busy === `rename:${store.id}`}
                              onClick={() => handleRename(store.id)}
                            >
                              {busy === `rename:${store.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudStore.save')}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditingId(null)}>
                              {t('cloudStore.cancel')}
                            </Button>
                          </div>
                        ) : isDeleting ? (
                          <div className="space-y-2">
                            <p className="text-xs text-destructive font-medium">
                              {t('cloudStore.deleteConfirm', { name: store.name })}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-8 text-xs"
                                disabled={busy === `delete:${store.id}`}
                                onClick={() => handleDelete(store.id)}
                              >
                                {busy === `delete:${store.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudStore.yesDelete')}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setConfirmDeleteId(null)}>
                                {t('cloudStore.cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                {isBound && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
                                <p className="text-sm font-semibold truncate">{store.name}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {!isBound && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => handleBind(store.id)}
                                  >
                                    <Link2 className="w-3 h-3" /> {t('cloudStore.connect')}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => { setEditingId(store.id); setEditName(store.name); }}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => setConfirmDeleteId(store.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                            {counts && (
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1"><Package className="w-3 h-3" />{counts.products} {t('cloudStore.stats.products')}</span>
                                <span className="flex items-center gap-1"><ShoppingCart className="w-3 h-3" />{counts.storeTransactions} {t('cloudStore.stats.transactions')}</span>
                                <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{counts.backups} {t('cloudStore.stats.backups')}</span>
                              </div>
                            )}
                            <p className="text-[10px] text-muted-foreground">
                              {t('cloudStore.created', { date: format(new Date(store.createdAt), 'dd MMM yyyy', { locale: dateLocale }) })}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Create form */}
              {showCreate && !atLimit && (
                <div className="rounded-xl border border-dashed p-3 space-y-2">
                  <p className="text-xs font-medium">
                    {stores.length === 0 ? t('cloudStore.createFirst') : t('cloudStore.addNew')}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      className="h-9 text-sm"
                      placeholder={t('cloudStore.storeNamePlaceholder')}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-9"
                      disabled={!newName.trim() || busy === 'create'}
                      onClick={handleCreate}
                    >
                      {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudStore.create')}
                    </Button>
                  </div>
                  {stores.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                      {t('cloudStore.cancel')}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
