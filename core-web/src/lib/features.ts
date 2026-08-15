let profileArchiveImportEnabled = false;

export function configureProfileArchiveImport(enabled: boolean): void {
  profileArchiveImportEnabled = enabled;
}

export function isProfileArchiveImportEnabled(): boolean {
  return profileArchiveImportEnabled;
}
