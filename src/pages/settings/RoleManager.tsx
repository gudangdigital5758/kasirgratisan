import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Role, type PermissionKey, ALL_PERMISSIONS } from '@/lib/db';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Edit2, Trash2, ShieldCheck, UserCog, Users as UsersIcon, Save, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSION_LABELS, syncUsersToRole } from '@/lib/auth';
import { PERMISSION_GROUPS } from '@/lib/menu-permissions';
import { toast } from 'sonner';

export default function RoleManager() {
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const { isOwner, multiUserEnabled, refresh } = useAuth();
  const roles = useLiveQuery(() => db.roles.toArray());
  const users = useLiveQuery(() => db.users.toArray());

  // Editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<PermissionKey[]>([]);
  const [saving, setSaving] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<PermissionKey[]>([]);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const sortedRoles = (roles ?? []).slice().sort((a, b) => {
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn === 1 ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const roleUserCount = (roleId?: number) =>
    (users ?? []).filter((u) => u.roleId === roleId).length;

  const togglePerm = (
    key: PermissionKey,
    checked: boolean,
    setter: (updater: (prev: PermissionKey[]) => PermissionKey[]) => void,
  ) => {
    setter((prev) => (checked ? [...new Set([...prev, key])] : prev.filter((p) => p !== key)));
  };

  const openEditor = (role: Role) => {
    setEditRole(role);
    setRoleName(role.name);
    setRolePerms(role.permissions);
    setEditorOpen(true);
  };

  const saveRole = async () => {
    if (!editRole?.id) return;
    setSaving(true);
    try {
      // CLOUD-003: jangan set updatedAt manual — hook sync yang menetapkan
      // updatedAt + me-reset syncedAt agar edit role ikut tersinkron.
      const patch: Partial<Role> = { permissions: rolePerms };
      if (editRole.isBuiltIn === 0 && roleName.trim()) patch.name = roleName.trim();
      await db.roles.update(editRole.id, patch);
      await syncUsersToRole({ id: editRole.id, permissions: rolePerms });
      toast.success(t('roles.toast.saved'));
      setEditorOpen(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setNewName('');
    setNewPerms([]);
    setCreateOpen(true);
  };

  const saveCreate = async () => {
    if (!newName.trim()) {
      toast.error(t('roles.toast.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      await db.roles.add({
        name: newName.trim(),
        permissions: newPerms,
        isBuiltIn: 0,
        isActive: 1,
        createdAt: new Date(),
        syncedAt: null,
      });
      toast.success(t('roles.toast.created'));
      setCreateOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    // User dengan role ini → fallback ke role Sales (default bawaan).
    const sales = (roles ?? []).find((r) => r.name === 'Sales' && r.isBuiltIn === 1);
    await db.roles.delete(deleteTarget.id);
    if (sales?.id) {
      await db.users.filter((u) => u.roleId === deleteTarget.id).modify((u) => {
        u.roleId = sales.id;
        u.permissions = sales.permissions;
      });
    }
    toast.success(t('roles.toast.deleted'));
    setDeleteTarget(null);
    await refresh();
  };

  const renderPermToggles = (perms: PermissionKey[], setter: (updater: (prev: PermissionKey[]) => PermissionKey[]) => void) => (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.labelKey} className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(group.labelKey)}</p>
          <div className="space-y-1.5">
            {group.permissions.map((key) => {
              const meta = PERMISSION_LABELS[key];
              const checked = perms.includes(key);
              return (
                <label
                  key={key}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    checked ? 'border-primary/50 bg-primary/5' : 'border-muted bg-muted/30'
                  }`}
                >
                  <Switch checked={checked} onCheckedChange={(v) => togglePerm(key, v === true, setter)} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{meta.title}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">{meta.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (!multiUserEnabled) {
    return (
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <UserCog className="w-5 h-5 text-primary" />
            {t('roles.title')}
          </h1>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm font-semibold">{t('roles.notEnabled.title')}</p>
            <p className="text-xs text-muted-foreground">{t('roles.notEnabled.description')}</p>
            <Button size="sm" className="mt-2" onClick={() => navigate('/settings')}>
              {t('roles.notEnabled.button')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isOwner) {
    return <LockedPage title={t('roles.title')} permissionLabel={t('roles.lockedPermission')} />;
  }

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <UserCog className="w-5 h-5 text-primary" />
          {t('roles.title')}
        </h1>
      </div>

      <p className="text-xs text-muted-foreground">{t('roles.desc')}</p>

      <Button size="sm" className="w-full h-10 gap-1.5" onClick={openCreate}>
        <Plus className="w-4 h-4" />
        {t('roles.addButton')}
      </Button>

      {/* Administrator — role pemilik, implicit all */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2">
              {t('roles.administrator')}
              <Badge variant="secondary" className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20">
                {t('roles.builtIn')}
              </Badge>
            </p>
            <p className="text-[10px] text-muted-foreground">{t('roles.administratorDesc')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Roles lain */}
      <div className="space-y-2">
        {sortedRoles.map((role) => (
          <Card key={role.id} className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  <UsersIcon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{role.name}</p>
                    {role.isBuiltIn === 1 && (
                      <Badge variant="secondary" className="text-[9px] h-4">
                        {t('roles.builtIn')}
                      </Badge>
                    )}
                    {role.isActive === 0 && (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-muted text-muted-foreground">
                        {t('roles.inactive')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {role.permissions.length === 0
                      ? t('roles.noAccess')
                      : t('roles.accessCount', { count: role.permissions.length })}
                    {' · '}
                    {t('roles.usersCount', { count: roleUserCount(role.id) })}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditor(role)} title={t('roles.edit')}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  {role.isBuiltIn === 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteTarget(role)}
                      title={t('roles.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Editor role */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('roles.dialog.editTitle', { name: editRole?.name ?? '' })}</DialogTitle>
            <DialogDescription className="text-xs">{t('roles.dialog.editDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {editRole?.isBuiltIn === 0 && (
              <div className="space-y-1.5">
                <Label>{t('roles.dialog.nameLabel')}</Label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} className="h-11" />
              </div>
            )}
            {renderPermToggles(rolePerms, setRolePerms)}
            <Button className="w-full h-11 gap-1.5" onClick={saveRole} disabled={saving}>
              <Save className="w-4 h-4" />
              {saving ? t('roles.dialog.saving') : t('roles.dialog.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create role */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('roles.dialog.addTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('roles.dialog.addDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('roles.dialog.nameLabel')} *</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('roles.dialog.namePlaceholder')} className="h-11" />
            </div>
            {renderPermToggles(newPerms, setNewPerms)}
            <Button className="w-full h-11 gap-1.5" onClick={saveCreate} disabled={saving}>
              <Save className="w-4 h-4" />
              {saving ? t('roles.dialog.saving') : t('roles.dialog.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roles.deleteDialog.title', { name: deleteTarget?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('roles.deleteDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('roles.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <X className="w-4 h-4" />
              {t('roles.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
