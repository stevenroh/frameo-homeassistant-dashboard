'use strict';
// Recipes tab: search and favourites from the Garfinho integration, and a recipe's ingredients and steps.

// --- recipes (Garfinho integration) ---

// The tags the filter chips send, exactly as Garfinho spells them (emoji included).
var RECIPE_TAGS = ['Jantar', 'Almoço', 'Sem carne', '🌱 Vegana', 'Até 30 min', 'Fácil', '❄️ Congelável', '🍎 Lancheirinha', 'Airfryer', 'Sem glúten'];

function tagLabel(tag) { return String(tag).replace(/^[^A-Za-zÀ-ÿ0-9]+/, '').trim(); }

// garfinho.search response -> [{ id, title, image, tags, ingredients }]
function parseRecipes(result) {
  var list = result && result.response && result.response.recipes;
  if (!list) return [];
  return list.map(function (r) {
    return { id: r.id, title: r.title || '', image: r.image || '', tags: r.tags || [], ingredients: r.ingredients || [] };
  });
}

// Photos come as 1350 px squares; ask the image host for a card-sized crop instead.
function thumbUrl(url, w, h) {
  if (!url || url.indexOf('imgix.net') < 0) return url || '';
  return url.replace(/\?.*$/, '') + '?width=' + w + '&height=' + h + '&fit=crop';
}

function recipeSearchData(text, tags) {
  var d = { limit: 100, sort: text ? 'relevance' : 'title' };
  if (text) d.text = text;
  if (tags && tags.length) d.tags = tags;
  return d;
}

// Ingredient names as Garfinho indexes them also hold the nutritionist and search aliases; show the leading ones.
function recipeIngredients(r) {
  return r.ingredients.filter(function (i) { return !/^Nutricionista\b/i.test(i); }).slice(0, 12);
}

function htmlText(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// garfinho/recipe html (headings, lists, paragraphs) -> { groups: [{ title, items }], steps, notes }
function parseRecipeHtml(html) {
  var out = { groups: [], steps: [], notes: [] };
  if (!html) return out;
  var re = /<(h[1-6]|ul|ol|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  var title = '';
  var m;
  function items(inner) {
    var r = [];
    inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, function (_, li) { var t = htmlText(li); if (t) r.push(t); return ''; });
    return r;
  }
  while ((m = re.exec(html))) {
    var tag = m[1].toLowerCase();
    if (tag.charAt(0) === 'h') title = htmlText(m[2]).replace(/:$/, '');
    else if (tag === 'ul') { var it = items(m[2]); if (it.length) out.groups.push({ title: title, items: it }); }
    else if (tag === 'ol') out.steps = out.steps.concat(items(m[2]));
    else {
      var t = htmlText(m[2]);
      // A bold "Modo de preparo:" line works as a heading in the app's text.
      if (/^(<(strong|b|em)>)+[^<]{1,40}:\s*(<\/(strong|b|em)>)+\s*$/i.test(m[2].trim())) title = t.replace(/:$/, '');
      else if (t) out.notes.push(t);
    }
  }
  // Ingredients headed "Ingredientes" need no label; keep labels like "Massa" or "Cobertura".
  out.groups.forEach(function (g) { if (/^ingredientes?$/i.test(g.title)) g.title = ''; });
  return out;
}

// The full text of one recipe, over the websocket (the same command the Garfinho panel uses).
function recipeContentCall(state, rid) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'recipe-content', rid: rid };
  return { state: state, send: [{ id: id, type: 'garfinho/recipe', recipe_id: rid }] };
}


// A recipe search; `key` comes back with the result.
function recipeCall(state, key, data) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'recipes', key: key };
  return { state: state, send: [{ id: id, type: 'call_service', domain: 'garfinho', service: 'search',
    service_data: data, return_response: true }] };
}


function recipesTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var toast = ctx.toast;
  var state = null;
  var recipes = cfg.recipes || null;
  var rcTab = 'all';          // all | fav
  var rcText = '';
  var rcTags = [];
  var rcAll = [];             // last search result
  var rcLoading = false;
  var rcFailed = false;
  var rcPage = 0;
  var rcOpen = null;          // recipe id on the detail page
  var rcDone = {};            // ticked ingredients: id -> { name: true }
  var rcCache = {};           // favourite title -> recipe
  var rcAsked = {};           // favourite titles already requested
  var rcContent = {};         // recipe id -> parsed text (null: could not load)
  var rcStep = {};            // recipe id -> current step index
  var rcSeq = 0;
  var RC_PER = 8;
  var HEART = '<svg width="22" height="22" viewBox="0 0 24 24" fill="FILL" stroke="STROKE" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path></svg>';

  function favTitles() {
    var e = recipes && store[recipes.favorites];
    return (e && e.a.recipes) || [];
  }
  function isFav(r) { return favTitles().indexOf(r.title) >= 0; }
  function heart(on) { return HEART.replace('FILL', on ? '#b3264f' : 'none').replace('STROKE', on ? '#b3264f' : 'currentColor'); }

  function rcList() {
    if (rcTab === 'fav') {
      var q = rcText.toLowerCase();
      return favTitles().map(function (t) { return rcCache[t]; }).filter(function (r) {
        return r && (!q || r.title.toLowerCase().indexOf(q) >= 0) &&
          rcTags.every(function (t) { return r.tags.indexOf(t) >= 0; });
      });
    }
    return rcAll;
  }

  function rcSearch() {
    if (!state || !state.subId) return;
    rcLoading = true;
    rcFailed = false;
    rcPage = 0;
    var key = 'q' + (++rcSeq);
    sendAll(recipeCall(state, key, recipeSearchData(rcText, rcTags)).send);
    renderRecipes();
  }

  // Favourites come by title from the sensor; fetch each recipe once so the cards can show photos and tags.
  function rcFetchFavs() {
    if (!state || !state.subId) return;
    favTitles().forEach(function (t) {
      if (rcCache[t] || rcAsked[t]) return;
      rcAsked[t] = true;
      sendAll(recipeCall(state, 'f:' + t, { text: t, limit: 5 }).send);
    });
  }

  function renderRecipes() {
    if (ctx.view() !== 'recipes' || !recipes) return;
    var det = rcOpen && rcList().filter(function (r) { return r.id === rcOpen; })[0];
    $('rc-browse').style.display = det ? 'none' : '';
    $('rc-detail').style.display = det ? '' : 'none';
    if (det) { renderRecipe(det); return; }
    $('rc-tab-all').className = 'seg' + (rcTab === 'all' ? ' on' : '');
    $('rc-tab-fav').className = 'seg' + (rcTab === 'fav' ? ' on' : '');
    setText('rc-fav-n', String(favTitles().length));
    setHTML('rc-chips', RECIPE_TAGS.map(function (t) {
      var on = rcTags.indexOf(t) >= 0;
      return '<button class="chip' + (on ? ' on' : '') + '" data-tag="' + esc(t) + '">' + (on ? CHECK : '') + esc(tagLabel(t)) + '</button>';
    }).join(''));
    var list = rcList();
    var pages = Math.max(1, Math.ceil(list.length / RC_PER));
    if (rcPage >= pages) rcPage = pages - 1;
    var slice = list.slice(rcPage * RC_PER, rcPage * RC_PER + RC_PER);
    setText('rc-count', list.length ? (rcTab === 'all' && list.length >= 100 ? '100+ recettes' : list.length + ' recettes') : '');
    setText('rc-page', pages > 1 ? (rcPage + 1) + ' / ' + pages : '');
    $('rc-prev').disabled = rcPage === 0;
    $('rc-next').disabled = rcPage >= pages - 1;
    var loading = rcTab === 'all' ? rcLoading : favTitles().some(function (t) { return !rcCache[t]; });
    setHTML('rc-grid', slice.length ? slice.map(function (r) {
      return '<button class="rcard" data-id="' + esc(r.id) + '"><span class="rimg">' +
        (r.image ? '<img src="' + esc(thumbUrl(r.image, 320, 200)) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</span>' +
        '<span class="rheart" data-fav="' + esc(r.id) + '">' + heart(isFav(r)) + '</span>' +
        '<span class="rbody"><span class="rtitle">' + esc(r.title) + '</span><span class="rtags">' +
        r.tags.slice(0, 3).map(function (t) { return '<span class="rtag">' + esc(tagLabel(t)) + '</span>'; }).join('') +
        '</span><span class="rmeta">' + r.ingredients.length + ' ingredients</span></span></button>';
    }).join('') : '<div class="rc-empty">' + (rcFailed ? 'Garfinho injoignable' : loading ? 'Chargement…' :
      rcTab === 'fav' ? 'Pas encore de favoris' : 'Aucune recette trouvée') + '</div>');
  }

  function rcLoadContent(r) {
    if (!state || !state.subId || r.id in rcContent || rcContent['@' + r.id]) return;
    rcContent['@' + r.id] = true; // asked
    sendAll(recipeContentCall(state, r.id).send);
  }

  function renderRecipe(r) {
    var list = rcList();
    var i = list.indexOf(r);
    rcLoadContent(r);
    var c = rcContent[r.id];
    setText('rd-pos', (i + 1) + ' sur ' + list.length);
    setText('rd-title', r.title);
    $('rd-photo').style.backgroundImage = r.image ? 'url(' + thumbUrl(r.image, 640, 400) + ')' : 'none';
    setHTML('rd-heart', heart(isFav(r)));
    $('rd-heart').setAttribute('aria-label', isFav(r) ? 'Retirer des favoris' : 'Ajouter aux favoris');
    $('rd-heart').className = 'rd-btn' + (isFav(r) ? ' fav' : '');
    // Quantities come with the text; until it loads (or if it has none) show the ingredient names.
    var groups = c && c.groups.length ? c.groups : [{ title: '', items: recipeIngredients(r) }];
    var done = rcDone[r.id] || {};
    var total = 0;
    var ready = 0;
    var html = '';
    groups.forEach(function (g, gi) {
      if (g.title) html += '<div class="ing-group">' + esc(g.title) + '</div>';
      g.items.forEach(function (n, ni) {
        var k = gi + ':' + ni;
        var d = !!done[k];
        total++;
        if (d) ready++;
        html += '<button class="ing' + (d ? ' done' : '') + '" data-ing="' + k + '"><span class="ing-dot">' + (d ? CHECK : '') + '</span>' + esc(n) + '</button>';
      });
    });
    setText('rd-ing-n', ready + ' sur ' + total + ' prêts');
    setHTML('rd-ings', html);
    var cur = rcStep[r.id] || 0;
    var steps = c ? c.steps : [];
    setText('rd-step-n', steps.length ? 'Étape ' + (Math.min(cur, steps.length - 1) + 1) + ' sur ' + steps.length : '');
    setHTML('rd-steps', steps.length ? steps.map(function (t, k) {
      var cls = k === cur ? ' now' : k < cur ? ' past' : '';
      return '<button class="step' + cls + '" data-step="' + k + '"><span class="step-n">' + (k < cur ? CHECK : k + 1) + '</span><span class="step-t">' + esc(t) + '</span></button>';
    }).join('') + (c ? c.notes.map(function (t) { return '<span class="rd-note">' + esc(t) + '</span>'; }).join('') : '') : '<div class="rc-empty-s">' + (c === undefined ? 'Chargement de la préparation…' : c === null ? 'Impossible de charger la préparation' : 'Pas d’instructions pour cette recette') + '</div>');
    $('rd-prev').disabled = i <= 0;
    $('rd-next').disabled = i >= list.length - 1;
  }

  function rcToggleFav(r) {
    if (!state || !r) return;
    var on = isFav(r);
    var e = store[recipes.favorites];
    if (e) { // show it now; the sensor confirms after the refresh
      var cur = (e.a.recipes || []).filter(function (t) { return t !== r.title; });
      e.a.recipes = on ? cur : cur.concat(r.title);
    }
    rcCache[r.title] = r;
    sendAll(serviceCall(state, 'garfinho', on ? 'remove_favorite' : 'add_favorite', null, { recipe_id: r.id }).send);
    setTimeout(function () { if (state) sendAll(serviceCall(state, 'garfinho', 'refresh', null, {}).send); }, 1200);
    toast(on ? 'Retiré des favoris' : 'Ajouté aux favoris');
    renderRecipes();
  }

  if (recipes) {
    $('rc-tab-all').onclick = function () { rcTab = 'all'; rcPage = 0; renderRecipes(); };
    $('rc-tab-fav').onclick = function () { rcTab = 'fav'; rcPage = 0; rcFetchFavs(); renderRecipes(); };
    $('rc-go').onclick = function () { rcText = $('rc-q').value.replace(/\s+/g, ' ').trim(); $('rc-q').blur(); if (rcTab === 'all') rcSearch(); else renderRecipes(); };
    $('rc-q').onkeydown = function (e) { if (e.keyCode === 13) $('rc-go').onclick(); };
    $('rc-chips').onclick = function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      var t = b.getAttribute('data-tag');
      var at = rcTags.indexOf(t);
      if (at >= 0) rcTags.splice(at, 1); else rcTags.push(t);
      if (rcTab === 'all') rcSearch(); else renderRecipes();
    };
    $('rc-prev').onclick = function () { rcPage--; renderRecipes(); };
    $('rc-next').onclick = function () { rcPage++; renderRecipes(); };
    $('rc-grid').onclick = function (e) {
      var h = e.target.closest('.rheart');
      var c = e.target.closest('.rcard');
      if (!c) return;
      var r = rcList().filter(function (x) { return x.id === c.getAttribute('data-id'); })[0];
      if (h) { rcToggleFav(r); return; }
      rcOpen = r && r.id;
      renderRecipes();
    };
    $('rd-back').onclick = function () { rcOpen = null; renderRecipes(); };
    function rdStep(d) {
      var list = rcList();
      var i = list.map(function (r) { return r.id; }).indexOf(rcOpen) + d;
      if (i >= 0 && i < list.length) { rcOpen = list[i].id; renderRecipes(); }
    }
    $('rd-prev').onclick = function () { rdStep(-1); };
    $('rd-next').onclick = function () { rdStep(1); };
    $('rd-heart').onclick = function () { rcToggleFav(rcList().filter(function (r) { return r.id === rcOpen; })[0]); };
    $('rd-ings').onclick = function (e) {
      var b = e.target.closest('.ing');
      if (!b) return;
      var m = rcDone[rcOpen] || (rcDone[rcOpen] = {});
      var n = b.getAttribute('data-ing');
      if (m[n]) delete m[n]; else m[n] = true;
      renderRecipes();
    };
    $('rd-steps').onclick = function (e) {
      var b = e.target.closest('.step');
      if (!b) return;
      var k = +b.getAttribute('data-step');
      rcStep[rcOpen] = rcStep[rcOpen] === k ? k + 1 : k; // tap the current step again to finish it
      renderRecipes();
    };
  }

  if (!recipes) $('nav-recipes').style.display = 'none';

  return {
    onConnecting: function (s) {
      state = s;
      rcAsked = {};
      Object.keys(rcContent).forEach(function (k) { if (k.charAt(0) === '@') delete rcContent[k]; });
      rcAll = [];
      rcLoading = false;
    },
    onConnected: function () { if (ctx.view() === 'recipes' && recipes) { rcSearch(); rcFetchFavs(); } },
    onView: function (v) {
      if (v === 'recipes') { if (!rcAll.length && !rcLoading) rcSearch(); rcFetchFavs(); renderRecipes(); }
    },
    onUpdate: function (u, changed) {
      if (u.kind === 'entities') {
        if (ctx.view() === 'recipes' && recipes && changed.has(recipes.favorites)) { rcFetchFavs(); renderRecipes(); }
      } else if (u.kind === 'recipes') {
        if (u.key.indexOf('f:') === 0) {
          var want = u.key.slice(2);
          u.items.forEach(function (r) { if (r.title === want) rcCache[want] = r; });
        } else if (u.key === 'q' + rcSeq) {
          rcAll = u.items;
          rcLoading = false;
        }
        renderRecipes();
      } else if (u.kind === 'recipe-content') {
        rcContent[u.rid] = u.content;
        renderRecipes();
      } else if (u.kind === 'recipes-failed') {
        if (u.key === 'q' + rcSeq) { rcLoading = false; rcFailed = true; }
        if (u.key.indexOf('f:') === 0) delete rcAsked[u.key.slice(2)];
        renderRecipes();
      }
    },
  };
}
