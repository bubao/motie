; =============================================================================
; installer.nsi - Motie Windows installer (NSIS MUI2, per-user, no UAC)
;
; Built by scripts/package.sh via makensis:
;   makensis -DVERSION=<ver> -DEXE_SRC=<exe> -DOUT_FILE=<setup.exe> scripts/installer.nsi
;
; NOTE: keep this file pure ASCII. Some makensis builds (e.g. Homebrew on
; macOS) reject any non-ASCII byte in the script regardless of UTF-8 BOM.
; On Windows/Linux makensis you may switch to a UTF-8-BOM Chinese variant.
; =============================================================================

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "0.0.1"
!endif
!ifndef EXE_SRC
  !define EXE_SRC "motie.exe"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "motie-setup.exe"
!endif

!define APP_NAME         "Motie"
!define APP_EXE          "motie.exe"
!define APP_UNINSTALL_ID "Motie"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Motie"
InstallDirRegKey HKCU "Software\${APP_UNINSTALL_ID}" "InstallDir"
RequestExecutionLevel user

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Motie"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install" SecCore
  SetOutPath "$INSTDIR"
  File "${EXE_SRC}"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Motie.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\Motie.lnk" "$INSTDIR\${APP_EXE}"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APP_UNINSTALL_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}" \
    "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}" \
    "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Motie.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Motie.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\${APP_UNINSTALL_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_ID}"
SectionEnd
