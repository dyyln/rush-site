export const PREFS_KEY = "rushsite.prefs.v1";

// Runs in the document head before paint so the palette and hidden ratings never flash
export const PREFS_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"{}");var h=document.documentElement;if(p.tiersOnly)h.dataset.tiersOnly="true";if(p.cbPalette)h.dataset.palette="cb"}catch(e){}`;
