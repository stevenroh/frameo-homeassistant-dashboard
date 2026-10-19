'use strict';
// The to-do card on the Home tab and its add sheet.

// --- to-do list (a Home Assistant todo.* entity) ---

// todo.get_items response -> open items, dated ones first (soonest first), then undated in list order.
function parseTodos(result, eid) {
  var items = result && result.response && result.response[eid] && result.response[eid].items;
  if (!items) return [];
  var open = items.filter(function (i) { return i.status !== 'completed'; }).map(function (i, n) {
    return {
      uid: i.uid,
      summary: cleanTitle(i.summary || ''),
      due: i.due ? parseDate(i.due) : null,
      dueHasTime: !!i.due && i.due.length > 10,
      n: n,
    };
  });
  open.sort(function (a, b) {
    if (a.due && b.due) return (a.due - b.due) || (a.n - b.n);
    if (a.due || b.due) return a.due ? -1 : 1;
    return a.n - b.n;
  });
  return open;
}

// "18:00", "Tomorrow 09:00", "Mon 20 Oct"; a past due time is flagged overdue.
function todoDue(item, now) {
  if (!item.due) return { text: '', overdue: false };
  var diff = dayDiff(item.due, now);
  var day = diff === 0 ? '' : diff === 1 ? 'Tomorrow' : shortDate(item.due);
  var time = item.dueHasTime ? formatTime(item.due) : '';
  var overdue = item.dueHasTime ? item.due < now : diff < 0;
  return { text: (day && time ? day + ' ' : day) + time || 'Today', overdue: overdue };
}

// Quick reminder choices for a new item; the frame has no date picker, so these are presets.
function reminderOptions(now) {
  var opts = [{ id: 'none', label: 'No reminder', due: null }];
  opts.push({ id: 'hour', label: 'In 1 hour', due: new Date(now.getTime() + 3600000) });
  var evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0);
  if (evening - now > 30 * 60000) opts.push({ id: 'evening', label: 'This evening', due: evening });
  var tomorrow = addDays(now, 1);
  opts.push({ id: 'morning', label: 'Tomorrow 09:00',
    due: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0) });
  return opts;
}


function todoCard(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var state = null;
  var todoReady = false; // the first snapshot only seeds the store; the list is fetched on connect

  var todos = [];
  var newDue = null;

  function renderTodos() {
    var now = new Date();
    setText('todo-count', todos.length + ' open');
    setHTML('todo-list', todos.map(function (t) {
      var d = todoDue(t, now);
      return '<div class="todo" data-uid="' + esc(t.uid) + '"><span class="todo-box"></span>' +
        '<span class="todo-title">' + esc(t.summary) + '</span>' +
        (d.text ? '<span class="todo-due' + (d.overdue ? ' overdue' : '') + '">' + d.text + '</span>' : '') + '</div>';
    }).join('') || '<div class="muted">Nothing to do</div>');
  }

  function refetchTodos() {
    if (cfg.todo && state && state.subId) sendAll(refresh(state, cfg, 'todo').send);
  }

  function renderReminderChoices() {
    setHTML('todo-when', reminderOptions(new Date()).map(function (o) {
      var on = (o.due ? o.due.getTime() : 0) === (newDue ? newDue.getTime() : 0);
      return '<button class="seg' + (on ? ' on' : '') + '" data-due="' + (o.due ? o.due.getTime() : '') + '"><span class="chk">' +
        CHECK + '</span>' + o.label + '</button>';
    }).join(''));
  }

  function openTodoSheet() {
    newDue = null;
    $('todo-input').value = '';
    renderReminderChoices();
    $('scrim').style.display = '';
    $('todo-sheet').style.display = '';
    $('todo-input').focus();
  }

  function closeTodoSheet() {
    $('todo-input').blur();
    $('scrim').style.display = 'none';
    $('todo-sheet').style.display = 'none';
  }

  function saveTodo() {
    var text = $('todo-input').value.replace(/\s+/g, ' ').trim();
    if (!text || !state) return;
    var data = { item: text };
    if (newDue) data.due_datetime = localIso(newDue);
    sendAll(serviceCall(state, 'todo', 'add_item', cfg.todo, data).send);
    todos = todos.concat([{ uid: 'new-' + Date.now(), summary: text, due: newDue, dueHasTime: !!newDue, n: todos.length }]);
    renderTodos();
    closeTodoSheet();
    setTimeout(refetchTodos, 800);
  }

  $('todo-add').onclick = openTodoSheet;
  $('todo-save').onclick = saveTodo;
  $('todo-cancel').onclick = closeTodoSheet;
  $('todo-input').onkeydown = function (ev) { if (ev.keyCode === 13) saveTodo(); };
  $('todo-when').onclick = function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var v = b.getAttribute('data-due');
    newDue = v ? new Date(+v) : null;
    renderReminderChoices();
  };
  $('todo-list').onclick = function (ev) {
    var row = ev.target.closest('.todo');
    if (!row || !state) return;
    var uid = row.getAttribute('data-uid');
    if (uid.indexOf('new-') === 0) return;
    sendAll(serviceCall(state, 'todo', 'update_item', cfg.todo, { item: uid, status: 'completed' }).send);
    todos = todos.filter(function (t) { return t.uid !== uid; });
    renderTodos();
    setTimeout(refetchTodos, 800);
  };

  if (!cfg.todo) { $('todo-box').style.display = 'none'; $('todo-add').style.display = 'none'; }
  setInterval(refetchTodos, 5 * 60000);

  return {
    onConnecting: function (s) { state = s; todoReady = false; },
    onUpdate: function (u, changed) {
      if (u.kind === 'entities') {
        if (cfg.todo && changed.has(cfg.todo) && todoReady) refetchTodos(); // list changed elsewhere (phone, HA)
        todoReady = true;
      } else if (u.kind === 'todo') {
        todos = u.items;
        renderTodos();
      }
    },
    onTick: function () { renderTodos(); }, // due times turn overdue as the minutes pass
    closeSheet: closeTodoSheet,
  };
}
