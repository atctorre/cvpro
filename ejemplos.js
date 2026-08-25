/* CVPro · ejemplos.js
   El HTML del CV es idéntico en las 20 plantillas: lo único que cambia es
   la clase raíz (.cv-h1 → .cv-m7). Por eso la página lleva UN solo CV y el
   cambio de plantilla es un cambio de className — instantáneo y sin peso.
   Antes se incrustaban 20 copias del mismo HTML (106KB por página). */
var TPL_IDS = ['h1','h2','h3','h4','h5','h6','h7','h8','h9','h10','m1','m2','m3','m4','m5','m6','m7','m8','m9','m10'];

function verPlantilla(id, btn) {
  var cv = document.getElementById('cvDemo');
  if (!cv) return;
  TPL_IDS.forEach(function(t){ cv.classList.remove('cv-' + t); });
  cv.classList.add('cv-' + id);
  document.querySelectorAll('.tpl-btn').forEach(function(b){ b.classList.remove('activo'); });
  if (btn) btn.classList.add('activo');
  try { localStorage.setItem('cvpro_tpl_preferida', id); } catch(e) {}
}

document.addEventListener('DOMContentLoaded', function() {
  var pref = null;
  try { pref = localStorage.getItem('cvpro_tpl_preferida'); } catch(e) {}
  if (pref && TPL_IDS.indexOf(pref) !== -1) {
    var b = document.querySelector('.tpl-btn[data-t="' + pref + '"]');
    verPlantilla(pref, b);
  }
});
