(() => {
  'use strict';
  const KEY='gpsspeed.settings.v1';
  const defaults={speedUnit:'kmh',speedAlertEnabled:false,speedAlertLimit:100,theme:'dark',mapOrientation:'north',kmMarkers:true,speedColors:true};
  function apply(settings){const theme=settings?.theme==='light'?'light':'dark';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}
  function load(){try{const raw=localStorage.getItem(KEY),stored=raw?JSON.parse(raw):{};const s={...defaults,...stored};if(stored.darkMode===false&&!stored.theme)s.theme='light';apply(s);return s;}catch(_){const s={...defaults};apply(s);return s;}}
  function save(next){const s={...defaults,...load(),...(next||{})};s.speedAlertLimit=Math.min(300,Math.max(10,+s.speedAlertLimit||100));s.theme=s.theme==='light'?'light':'dark';localStorage.setItem(KEY,JSON.stringify(s));apply(s);window.dispatchEvent(new CustomEvent('gpsspeed:settings-change',{detail:{settings:s}}));return s;}
  window.GPSSpeedSettings={load,save,apply,defaults:{...defaults}};
  load();
})();