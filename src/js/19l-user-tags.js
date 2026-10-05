/* osu!lazer's user tags: after playing a beatmap, players vote on what it is (jumpstream, long notes, technical…) from
 * a fixed list; the tags with votes show in song select's details. The server keeps the votes, by the beatmap file's
 * id, and only takes them from players with a score on it. */

const UserTags = {
  cache: new Map(), // key → { tags: [{tag, n, mine}], all, can, at }
  get(key) { return this.cache.get(key) || null; },
  /** Ask the server (at most every 20 s per beatmap unless `force`). */
  ask(key, force = false) {
    if (!key || typeof Presence === 'undefined') return;
    const c = this.cache.get(key);
    if (!force && c && Date.now() - c.at < 20000) return;
    if (c) c.at = Date.now(); else this.cache.set(key, { tags: [], all: [], can: false, at: Date.now(), pending: true });
    Presence.start();
    Presence.send({ t: 'tags', key });
  },
  vote(key, tag, on) {
    if (!Presence.ws) { Toast.err('Can\'t tag right now', 'You\'re not connected to the online service.'); return; }
    // (shown straight away; the server's answer settles it)
    const c = this.cache.get(key);
    if (c) {
      const t = c.tags.find(x => x.tag === tag);
      if (on && !t) c.tags.push({ tag, n: 1, mine: true });
      else if (t && t.mine !== on) { t.mine = on; t.n += on ? 1 : -1; if (t.n <= 0) c.tags = c.tags.filter(x => x !== t); }
      Bus.emit('tags', key);
    }
    Presence.send({ t: 'tagVote', key, tag, on: !!on });
  },
  on(m) {
    if (!m || !m.key) return;
    this.cache.set(m.key, { tags: Array.isArray(m.tags) ? m.tags : [], all: Array.isArray(m.all) ? m.all : [], can: !!m.can, at: Date.now() });
    if (m.err) Toast.show('Tag not added', m.err);
    Bus.emit('tags', m.key);
  },
  /** The tags with votes, as chips (song select). */
  chips(key, onClick) {
    const c = this.get(key);
    if (!c || !c.tags.length) return null;
    return h('div.md-tags', ...c.tags.slice(0, 12).map(t => h(`${onClick ? 'button' : 'span'}.md-tag.ut${t.mine ? '.mine' : ''}`, { title: `${t.n} vote${t.n === 1 ? '' : 's'}`, onclick: onClick ? () => onClick(t.tag) : null }, t.tag, h('small', String(t.n)))));
  },
  /** lazer's results-screen panel: every tag, the ones with votes first; click to vote or take it back. */
  panel(key) {
    const el = h('div.ut-panel');
    const paint = () => {
      const c = this.get(key) || { tags: [], all: [], can: false };
      const votes = new Map(c.tags.map(t => [t.tag, t])), all = [...new Set([...c.tags.map(t => t.tag), ...c.all])];
      clearEl(el).append(
        h('div.ut-head', h('b', 'Tags'), h('span.muted', c.can ? 'What is this beatmap? Vote for the tags that fit.' : c.pending ? 'Loading…' : 'Your score has to reach the server before you can tag the beatmap.')),
        all.length ? h('div.ut-list', ...all.map(tag => {
          const v = votes.get(tag);
          return h(`button.ut-chip${v && v.mine ? '.mine' : ''}${v ? '.voted' : ''}`, { disabled: !c.can, onclick: () => { UISounds.click(); this.vote(key, tag, !(v && v.mine)); } }, tag, v ? h('small', String(v.n)) : null);
        })) : null);
    };
    paint();
    const off = Bus.on('tags', k => { if (k === key) { if (!document.body.contains(el)) off(); else paint(); } });
    this.ask(key, true);
    // (a score sent a moment ago may not have reached the server yet: ask again shortly)
    setTimeout(() => { const c = this.get(key); if (c && !c.can && document.body.contains(el)) this.ask(key, true); }, 4000);
    return el;
  },
};
