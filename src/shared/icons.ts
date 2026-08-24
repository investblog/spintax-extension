/**
 * Inline icon sprite — symbols copied by value from 301-ui/static/icons-sprite.svg
 * (ADR 0008; bell-off/download/console from redirect-inspector). Re-copy via the generator,
 * never hand-edit paths. Usage: injectIconSprite() once per page, then svgIcon('copy').
 */
export type IconName =
  | 'copy'
  | 'check-circle'
  | 'check'
  | 'alert-triangle'
  | 'alert-circle'
  | 'info'
  | 'close'
  | 'close-circle'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-right'
  | 'arrow-up'
  | 'open-in-new'
  | 'magnify'
  | 'filter'
  | 'bell'
  | 'help-circle'
  | 'cog'
  | 'layers'
  | 'menu-open'
  | 'menu-close'
  | 'backburger'
  | 'sun'
  | 'theme-light-dark'
  | 'upload'
  | 'play'
  | 'pause'
  | 'refresh'
  | 'trash'
  | 'plus'
  | 'clock'
  | 'pencil-circle'
  | 'eye'
  | 'target'
  | 'zap'
  | 'success'
  | 'logs'
  | 'web'
  | 'puzzle'
  | 'delete'
  | 'cancel'
  | 'key'
  | 'lock'
  | 'user'
  | 'home'
  | 'dots-vertical'
  | 'details'
  | 'search'
  | 'regex'
  | 'sync'
  | 'bell-off'
  | 'download'
  | 'console';

export const ICON_NAMES: readonly IconName[] = [
  'copy',
  'check-circle',
  'check',
  'alert-triangle',
  'alert-circle',
  'info',
  'close',
  'close-circle',
  'chevron-down',
  'chevron-up',
  'chevron-left',
  'chevron-right',
  'arrow-right',
  'arrow-up',
  'open-in-new',
  'magnify',
  'filter',
  'bell',
  'help-circle',
  'cog',
  'layers',
  'menu-open',
  'menu-close',
  'backburger',
  'sun',
  'theme-light-dark',
  'upload',
  'play',
  'pause',
  'refresh',
  'trash',
  'plus',
  'clock',
  'pencil-circle',
  'eye',
  'target',
  'zap',
  'success',
  'logs',
  'web',
  'puzzle',
  'delete',
  'cancel',
  'key',
  'lock',
  'user',
  'home',
  'dots-vertical',
  'details',
  'search',
  'regex',
  'sync',
  'bell-off',
  'download',
  'console',
];

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
<symbol id="i-mono-copy" viewBox="0 0 19 22"><path d="M17 20H6V6h11m0-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m-3-4H2a2 2 0 0 0-2 2v14h2V2h12z" fill="currentColor"/></symbol>
<symbol id="i-mono-check-circle" viewBox="0 0 20 20"><path d="M10 0C4.5 0 0 4.5 0 10s4.5 10 10 10 10-4.5 10-10S15.5 0 10 0m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m4.59-12.42L8 12.17 5.41 9.59 4 11l4 4 8-8z" fill="currentColor"/></symbol>
<symbol id="i-mono-check" viewBox="0 0 20 20"><path d="M6.75 17.77.54 11.56l2.83-2.83 3.38 3.39 9.88-9.89 2.83 2.83z" fill="currentColor"/></symbol>
<symbol id="i-mono-alert-triangle" viewBox="0 0 20 20"><path d="M10 1.364 0 18.636h20M10 5l6.846 11.818H3.155M9.09 8.636v3.637h1.818V8.636M9.09 14.091v1.818h1.818v-1.818" fill="currentColor"/></symbol>
<symbol id="i-mono-alert-circle" viewBox="0 0 20 20"><path d="M9 13h2v2H9zm0-8h2v6H9zm1-5C4.47 0 0 4.5 0 10A10 10 0 1 0 10 0m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16" fill="currentColor"/></symbol>
<symbol id="i-mono-info" viewBox="0 0 20 20"><path d="M11 7H9V5h2m0 10H9V9h2m-1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20" fill="currentColor"/></symbol>
<symbol id="i-mono-close" viewBox="0 0 20 20"><path d="M17 4.41L15.59 3L10 8.59L4.41 3L3 4.41L8.59 10L3 15.59L4.41 17L10 11.41L15.59 17L17 15.59L11.41 10L17 4.41Z" fill="currentColor"/></symbol>
<symbol id="i-mono-close-circle" viewBox="0 0 20 20"><path d="M10 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18C4.47 0 0 4.47 0 10s4.47 10 10 10 10-4.47 10-10S15.53 0 10 0m2.59 6L10 8.59 7.41 6 6 7.41 8.59 10 6 12.59 7.41 14 10 11.41 12.59 14 14 12.59 11.41 10 14 7.41z" fill="currentColor"/></symbol>
<symbol id="i-mono-chevron-down" viewBox="0 0 20 20"><path d="M5.41 6.29 10 10.88l4.59-4.59L16 7.71l-6 6-6-6z" fill="currentColor"/></symbol>
<symbol id="i-mono-chevron-up" viewBox="0 0 20 20"><path d="M5.41 13.705 10 9.125l4.59 4.58 1.41-1.41-6-6-6 6z" fill="currentColor"/></symbol>
<symbol id="i-mono-chevron-left" viewBox="0 0 24 24"><path d="M15.41 16.58 10.83 12l4.58-4.59L14 6l-6 6 6 6z" fill="currentColor"/></symbol>
<symbol id="i-mono-chevron-right" viewBox="0 0 24 24"><path d="M8.59 16.58 13.17 12 8.59 7.41 10 6l6 6-6 6z" fill="currentColor"/></symbol>
<symbol id="i-mono-arrow-right" viewBox="0 0 20 20"><path d="M2.08 8v4h9l-3.5 3.5L10 17.92 17.92 10 10 2.08 7.58 4.5l3.5 3.5z" fill="currentColor"/></symbol>
<symbol id="i-mono-arrow-up" viewBox="0 0 20 20"><path d="m10 5 5 5h-3v4H8v-4H5zm0 15A10 10 0 1 1 10-.002 10 10 0 0 1 10 20m0-2a8 8 0 1 0 0-16.001A8 8 0 0 0 10 18" fill="currentColor"/></symbol>
<symbol id="i-mono-open-in-new" viewBox="0 0 20 20"><path d="M12 1v2h3.59l-9.83 9.83 1.41 1.41L17 4.41V8h2V1m-2 16H3V3h7V1H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z" fill="currentColor"/></symbol>
<symbol id="i-mono-magnify" viewBox="0 0 20 20"><path d="M7.75 1.25a6.5 6.5 0 0 1 6.5 6.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27a6.52 6.52 0 0 1-4.23 1.56 6.5 6.5 0 1 1 0-13m0 2c-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5 4.5-2 4.5-4.5-2-4.5-4.5-4.5" fill="currentColor"/></symbol>
<symbol id="i-mono-filter" viewBox="0 0 20 20"><path d="M4 11h12V9H4M1 4v2h18V4M8 16h4v-2H8z" fill="currentColor"/></symbol>
<symbol id="i-mono-bell" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="none"/><path d="M18.571 16.19v.953H1.43v-.953l1.904-1.904V8.57a6.66 6.66 0 0 1 4.762-6.39v-.276a1.905 1.905 0 0 1 3.81 0v.276a6.66 6.66 0 0 1 4.762 6.39v5.715zm-6.666 1.905a1.905 1.905 0 1 1-3.81 0" fill="currentColor"/></symbol>
<symbol id="i-mono-help-circle" viewBox="0 0 20 20"><path d="M9 16h2v-2H9zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4" fill="currentColor"/></symbol>
<symbol id="i-mono-cog" viewBox="0 0 20 20"><path d="M9.73 13.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46a.49.49 0 0 0-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98L12.23.42a.506.506 0 0 0-.5-.42h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L2.3 9c-.04.34-.07.67-.07 1s.03.65.07.97L.19 12.63c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z" fill="currentColor"/></symbol>
<symbol id="i-mono-layers" viewBox="0 0 20 20"><path d="m10 14.465 7.36-5.73L19 7.465l-9-7-9 7 1.63 1.27m7.37 8.27-7.38-5.73L1 12.535l9 7 9-7-1.63-1.27z" fill="currentColor"/></symbol>
<symbol id="i-mono-menu-open" viewBox="0 0 20 20"><path d="M1 4h10v2H1zm0 10h10v2H1zm0-5h12v2H1zm13-4-1.42 1.39L16.14 10l-3.56 3.61L14 15l5-5z" fill="currentColor"/></symbol>
<symbol id="i-mono-menu-close" viewBox="0 0 20 20"><path d="M19 13.61 17.59 15l-5.01-5 5.01-5L19 6.39 15.44 10zM1 4h13v2H1zm0 7V9h10v2zm0 5v-2h13v2z" fill="currentColor"/></symbol>
<symbol id="i-mono-backburger" viewBox="0 0 20 20"><path d="m3.91 11 4 4-1.4 1.42L.09 10l6.42-6.42L7.91 5l-4 4h16v2zm16-7v2h-10V4zm0 10v2h-10v-2z" fill="currentColor"/></symbol>
<symbol id="i-mono-sun" viewBox="0 0 20 20"><path d="m2.318 16.446 1.282 1.28L5.236 16.1l-1.29-1.29M10 4.544A5.46 5.46 0 0 0 4.545 10 5.46 5.46 0 0 0 10 15.454 5.46 5.46 0 0 0 15.454 10 5.453 5.453 0 0 0 10 4.545m7.273 6.364H20V9.091h-2.727m-2.51 7.009 1.637 1.627 1.282-1.282-1.627-1.636m1.627-11.173L16.4 2.364 14.764 3.99l1.29 1.29M10.91 0H9.091v2.727h1.818M5.236 3.991 3.6 2.364 2.318 3.636l1.627 1.646zM0 10.909h2.727V9.091H0m10.91 8.182H9.09V20h1.82" fill="currentColor"/></symbol>
<symbol id="i-mono-theme-light-dark" viewBox="0 0 24 24"><path fill="currentColor" d="M7.5 2c-1.79 1.15-3 3.18-3 5.5s1.21 4.35 3.03 5.5C4.46 13 2 10.54 2 7.5A5.5 5.5 0 0 1 7.5 2m11.57 1.5 1.43 1.43L4.93 20.5 3.5 19.07zm-6.18 2.43L11.41 5 9.97 6l.42-1.7L9 3.24l1.75-.12.58-1.65L12 3.1l1.73.03-1.35 1.13zm-3.3 3.61-1.16-.73-1.12.78.34-1.32-1.09-.83 1.36-.09.45-1.29.51 1.27 1.36.03-1.05.87zM19 13.5a5.5 5.5 0 0 1-5.5 5.5c-1.22 0-2.35-.4-3.26-1.07l7.69-7.69c.67.91 1.07 2.04 1.07 3.26m-4.4 6.58 2.77-1.15-.24 3.35zm4.33-2.7 1.15-2.77 2.2 2.54zm1.15-4.96-1.14-2.78 3.34.24zM9.63 18.93l2.77 1.15-2.53 2.19z"/></symbol>
<symbol id="i-mono-upload" viewBox="0 0 20 20"><path d="M9.09 17.273H5q-2.072 0-3.536-1.428Q0 14.41 0 12.346q0-1.772 1.064-3.163a4.72 4.72 0 0 1 2.8-1.773q.572-2.09 2.272-3.382A6.22 6.22 0 0 1 10 2.727q2.664 0 4.51 1.855 1.854 1.845 1.854 4.509 1.572.182 2.6 1.364A3.97 3.97 0 0 1 20 13.182q0 1.71-1.19 2.9-1.192 1.19-2.9 1.19h-5v-6.5l1.454 1.41 1.272-1.273L10 7.273l-3.636 3.636 1.272 1.273 1.455-1.41z" fill="currentColor"/></symbol>
<symbol id="i-mono-play" viewBox="0 0 20 20"><path d="M6.5 3v14l11-7z" fill="currentColor"/></symbol>
<symbol id="i-mono-pause" viewBox="0 0 20 20"><path d="M13 14h-2V6h2m-4 8H7V6h2m1-6a10 10 0 1 0 0 20 10 10 0 0 0 0-20" fill="currentColor"/></symbol>
<symbol id="i-mono-refresh" viewBox="0 0 20 20"><path d="M15.65 4.35A7.96 7.96 0 0 0 10 2a8 8 0 1 0 0 16c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 10 16a6 6 0 1 1 0-12c1.66 0 3.14.69 4.22 1.78L11 9h7V2z" fill="currentColor"/></symbol>
<symbol id="i-mono-trash" viewBox="0 0 20 20"><path d="M4 17a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5H4zM6 7h8v10H6zm7.5-5-1-1h-5l-1 1H3v2h14V2z" fill="currentColor"/></symbol>
<symbol id="i-mono-plus" viewBox="0 0 20 20"><path d="M17 11h-6v6H9v-6H3V9h6V3h2v6h6z" fill="currentColor"/></symbol>
<symbol id="i-mono-clock" viewBox="0 0 24 24"><path d="M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12.5,7H11V13L15.75,15.85L16.5,14.62L12.5,12.25V7Z" fill="currentColor"/></symbol>
<symbol id="i-mono-pencil-circle" viewBox="0 0 20 20"><path d="M10 0a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8zm6.78 1a.7.7 0 0 0-.48.2l-1.22 1.21 2.5 2.5L18.8 3.7c.26-.26.26-.7 0-.95L17.25 1.2c-.13-.13-.3-.2-.47-.2m-2.41 2.12L7 10.5V13h2.5l7.37-7.38z" fill="currentColor"/></symbol>
<symbol id="i-mono-eye" viewBox="0 0 24 24"><path fill="currentColor" d="M12 9a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3m0 8a5 5 0 0 1-5-5 5 5 0 0 1 5-5 5 5 0 0 1 5 5 5 5 0 0 1-5 5m0-12.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5"/></symbol>
<symbol id="i-mono-target" viewBox="0 0 20 20"><path d="M17.355 5.967a2.61 2.61 0 0 0-2.592 2.324v.012l-2.021.541a2.55 2.55 0 0 0-1.112-.826l-.02-.006V5.81a2.618 2.618 0 1 0-1.945-.006l.018.006v2.139q-.333.127-.612.343l.005-.003-3.84-2.094a2 2 0 0 0 0-.231v.006a2.618 2.618 0 1 0-2.62 2.618 2.56 2.56 0 0 0 1.731-.675L8.07 9.967a2.4 2.4 0 0 0 0 .442v-.01c0 .352.07.7.205 1.024l-.007-.018-2.91 2.826a2.5 2.5 0 0 0-1.07-.24h-.051a2.627 2.627 0 1 0 2.627 2.626 2.5 2.5 0 0 0-.197-1.047l.006.016 2.91-2.826c.334.155.698.234 1.067.233h.005q.372-.003.725-.113l-.017.004.831 1.29c-.302.434-.465.95-.466 1.479v.008a2.627 2.627 0 1 0 2.626-2.627q-.29 0-.572.07l.016-.004-.915-1.389c.19-.31.31-.657.348-1.018l.001-.012 2.028-.541a2.618 2.618 0 1 0 2.12-4.156h-.025z" fill="currentColor"/></symbol>
<symbol id="i-mono-zap" viewBox="0 0 20 20"><path d="M3 0v11h3v9l7-12H9l4-8m2 13h2v2h-2zm0-8h2v6h-2z" fill="currentColor"/></symbol>
<symbol id="i-mono-success" viewBox="0 0 20 20"><path d="M10 0C4.5 0 0 4.5 0 10s4.5 10 10 10 10-4.5 10-10S15.5 0 10 0M8 15l-5-5 1.41-1.41L8 12.17l7.59-7.59L17 6z" fill="currentColor"/></symbol>
<symbol id="i-mono-logs" viewBox="0 0 23 20"><path d="M3 0v6H1V0zM1 20h2v-6H1zm3-10a2 2 0 1 0-2 2c1.11 0 2-.89 2-2m19-6v12c0 1.11-.89 2-2 2H9a2 2 0 0 1-2-2v-4l-2-2 2-2V4a2 2 0 0 1 2-2h12c1.11 0 2 .89 2 2m-5 7h-8v2h8zm2-4H10v2h10z" fill="currentColor"/></symbol>
<symbol id="i-mono-web" viewBox="0 0 20 20"><path d="M14.36 12c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2m-5.15 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56M12.34 12H7.66c-.1-.66-.16-1.32-.16-2s.06-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2M10 17.96c-.83-1.2-1.5-2.53-1.91-3.96h3.82c-.41 1.43-1.08 2.76-1.91 3.96M6 6H3.08A7.92 7.92 0 0 1 7.4 2.44C6.8 3.55 6.35 4.75 6 6m-2.92 8H6c.35 1.25.8 2.45 1.4 3.56A8 8 0 0 1 3.08 14m-.82-2C2.1 11.36 2 10.69 2 10s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2M10 2.03c.83 1.2 1.5 2.54 1.91 3.97H8.09C8.5 4.57 9.17 3.23 10 2.03M16.92 6h-2.95a15.7 15.7 0 0 0-1.38-3.56c1.84.63 3.37 1.9 4.33 3.56M10 0C4.47 0 0 4.5 0 10A10 10 0 1 0 10 0" fill="currentColor"/></symbol>
<symbol id="i-mono-puzzle" viewBox="0 0 20 20"><path d="M17.619 9.524h-1.428v-3.81a1.904 1.904 0 0 0-1.905-1.904h-3.81V2.38a2.381 2.381 0 0 0-4.762.001V3.81h-3.81A1.905 1.905 0 0 0 0 5.714v3.62h1.429A2.56 2.56 0 0 1 4 11.903a2.56 2.56 0 0 1-2.571 2.572H0v3.62A1.905 1.905 0 0 0 1.905 20h3.619v-1.429A2.56 2.56 0 0 1 8.095 16a2.56 2.56 0 0 1 2.572 2.571V20h3.619a1.905 1.905 0 0 0 1.905-1.905v-3.81h1.428a2.38 2.38 0 1 0 0-4.761" fill="currentColor"/></symbol>
<symbol id="i-mono-delete" viewBox="0 0 20 20"><path d="M17 2h-3.5l-1-1h-5l-1 1H3v2h14M4 17a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5H4z" fill="currentColor"/></symbol>
<symbol id="i-mono-cancel" viewBox="0 0 20 20"><path d="M10 0C15.5 0 20 4.5 20 10C20 15.5 15.5 20 10 20C4.5 20 0 15.5 0 10C0 4.5 4.5 0 10 0ZM10 2C8.1 2 6.4 2.6 5.1 3.7L16.3 14.9C17.3 13.5 18 11.8 18 10C18 5.6 14.4 2 10 2ZM14.9 16.3L3.7 5.1C2.6 6.4 2 8.1 2 10C2 14.4 5.6 18 10 18C11.9 18 13.6 17.4 14.9 16.3Z" fill="currentColor"/></symbol>
<symbol id="i-mono-key" viewBox="0 0 20 20"><path d="M18.182 9.09c0 5.046-3.491 9.765-8.182 10.91-4.69-1.145-8.182-5.864-8.182-10.91V3.637L10 0l8.182 3.636zM10 18.183c3.41-.91 6.364-4.964 6.364-8.891V4.818L10 1.982 3.636 4.818v4.473c0 3.927 2.955 7.982 6.364 8.89m0-13.637a2.727 2.727 0 0 1 2.727 2.728c0 1.19-.754 2.2-1.818 2.572v1.973h1.818v1.818H10.91v1.819H9.091v-5.61a2.72 2.72 0 0 1-1.818-2.572A2.727 2.727 0 0 1 10 4.545m0 1.819a.91.91 0 1 0 0 1.818.91.91 0 0 0 0-1.818" fill="currentColor"/></symbol>
<symbol id="i-mono-lock" viewBox="0 0 20 20"><path d="M10 14.714a1.714 1.714 0 1 0 0-3.428 1.714 1.714 0 0 0 0 3.428M15.143 7a1.714 1.714 0 0 1 1.714 1.714v8.572A1.714 1.714 0 0 1 15.143 19H4.857a1.714 1.714 0 0 1-1.714-1.714V8.714C3.143 7.763 3.914 7 4.857 7h.857V5.286a4.286 4.286 0 1 1 8.572 0V7zM10 2.714a2.57 2.57 0 0 0-2.571 2.572V7h5.142V5.286A2.57 2.57 0 0 0 10 2.714" fill="currentColor"/></symbol>
<symbol id="i-mono-user" viewBox="0 0 20 15"><path d="M14 13v2H0v-2s0-4 7-4 7 4 7 4m-3.5-9.5a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0M13.94 9A5.32 5.32 0 0 1 16 13v2h4v-2s0-3.63-6.06-4M13 0a3.4 3.4 0 0 0-1.93.59 5 5 0 0 1 0 5.82A3.4 3.4 0 0 0 13 7a3.5 3.5 0 1 0 0-7" fill="currentColor"/></symbol>
<symbol id="i-mono-home" viewBox="0 0 20 20"><path d="M10 1 0 10h3v8h14v-8h3M7 16H5v-6h2m4 6H9V8h2m4 8h-2v-4h2" fill="currentColor"/></symbol>
<symbol id="i-mono-dots-vertical" viewBox="0 0 20 20"><path d="M10 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4" fill="currentColor"/></symbol>
<symbol id="i-mono-details" viewBox="0 0 20 20"><path d="M4.38 4h11.25L10 14zM1 2l9 16 9-16z" fill="currentColor"/></symbol>
<symbol id="i-mono-search" viewBox="0 0 20 20"><path d="M1.864 10.91H0V9.09h1.864A8.18 8.18 0 0 1 9.09 1.865V0h1.818v1.864a8.18 8.18 0 0 1 7.227 7.227H20v1.818h-1.864a8.18 8.18 0 0 1-7.227 7.227V20H9.091v-1.864a8.18 8.18 0 0 1-7.227-7.227M10 3.635a6.364 6.364 0 1 0 0 12.728 6.364 6.364 0 0 0 0-12.728" fill="currentColor"/></symbol>
<symbol id="i-mono-regex" viewBox="0 0 20 20"><path d="M13 13.92c-.33.05-.66.08-1 .08s-.67-.03-1-.08v-3.51l-2.5 2.48c-.5-.39-1-.89-1.39-1.39L9.59 9H6.08C6.03 8.67 6 8.34 6 8s.03-.67.08-1h3.51L7.11 4.5c.19-.25.39-.5.65-.74.24-.26.49-.46.74-.65L11 5.59V2.08c.33-.05.66-.08 1-.08s.67.03 1 .08v3.51l2.5-2.48c.5.39 1 .89 1.39 1.39L14.41 7h3.51c.05.33.08.66.08 1s-.03.67-.08 1h-3.51l2.48 2.5c-.19.25-.39.5-.65.74-.24.26-.49.46-.74.65L13 10.41zM2 16a2 2 0 1 1 4 0 2 2 0 0 1-4 0" fill="currentColor"/></symbol>
<symbol id="i-mono-sync" viewBox="0 0 20 20"><path d="M10 15.455A5.454 5.454 0 0 1 4.545 10c0-.91.228-1.79.637-2.545L3.855 6.127A7.2 7.2 0 0 0 2.727 10 7.273 7.273 0 0 0 10 17.273V20l3.636-3.636L10 12.727m0-10V0L6.364 3.636 10 7.273V4.545A5.455 5.455 0 0 1 15.455 10c0 .91-.228 1.79-.637 2.546l1.327 1.327A7.2 7.2 0 0 0 17.274 10 7.273 7.273 0 0 0 10 2.727" fill="currentColor"/></symbol>
<symbol id="i-mono-bell-off" viewBox="0 0 24 24"><path d="M20.84 22.73 18.11 20H3v-1l2-2v-6c0-1.14.29-2.27.83-3.28L1.11 3l1.28-1.27 19.72 19.73zM19 15.8V9c0-3.07-1.64-5.64-4.5-6.32V2a1.5 1.5 0 0 0-3 0v.68c-.24.06-.47.13-.69.21zM12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" fill="currentColor"/></symbol>
<symbol id="i-mono-download" viewBox="0 0 24 24"><path d="M5 20h14v-2H5m14-9h-4V3H9v6H5l7 7z" fill="currentColor"/></symbol>
<symbol id="i-mono-console" viewBox="0 0 24 24"><path d="M20 19V7H4v12h16m0-16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5c0-1.11.9-2 2-2h16m-7 14v-2h5v2h-5m-3.42-4L5.57 9h2.83l3.3 3.3c.39.39.39 1.03 0 1.42L8.42 17H5.59l4-4z" fill="currentColor"/></symbol>
</svg>`;

let injected = false;

/** Parse the static sprite once and prepend it to <body>. Static constant — never user content. */
export function injectIconSprite(doc: Document = document): void {
  if (injected || doc.getElementById('spintax-icon-sprite')) return;
  const parsed = new DOMParser().parseFromString(SPRITE, 'image/svg+xml');
  const svg = doc.importNode(parsed.documentElement, true);
  svg.id = 'spintax-icon-sprite';
  doc.body.prepend(svg);
  injected = true;
}

/** <svg><use href="#i-mono-{name}"> — sizing via CSS (1.25em in controls, 1em inline). */
export function svgIcon(name: IconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-mono-${name}`);
  svg.appendChild(use);
  return svg;
}

/** Swap the symbol an existing icon points at (theme toggle, collapse toggle). */
export function setIcon(svg: SVGSVGElement, name: IconName): void {
  svg.querySelector('use')?.setAttribute('href', `#i-mono-${name}`);
}
