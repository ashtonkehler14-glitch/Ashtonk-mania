/* Zako Neru — a little chibi Neru who hangs out in the corner of the main menu, poking at her flip phone and
 * teasing you ("zako~"). Click her for a line; she also pipes up on her own now and then. Pure inline SVG. */

const ZakoNeru = {
  LINES: [
    'zako~ zako~ ♡',
    'Still no S rank? Zako~',
    'Your accuracy is sooo cute ♡',
    'Missed again? Zako zako~',
    'Hmph. Not bad… for a zako.',
    'Play a song already, slowpoke~',
    'Bet you can\'t full combo this one~',
    'Eh? You\'re still here? ♡',
    'I\'m busy texting. …Fine, one song.',
    'Try hitting the notes this time~',
  ],
  svg() {
    const hair = '#f7d64e', hairS = '#e2b52c', hairH = '#fff2a6', skin = '#ffe9de', line = '#4a2c14';
    return `<svg class="neru-svg" viewBox="0 0 230 290" aria-hidden="true">
  <ellipse class="neru-glow" cx="112" cy="150" rx="100" ry="112"/>
  <!-- ponytail (her left) -->
  <g class="neru-tail">
    <path d="M150 60 C210 38 232 112 214 172 C204 212 218 242 202 276 C188 244 172 220 177 178 C182 136 170 104 150 92 Z" fill="${hair}"/>
    <path d="M168 70 C200 70 212 120 202 164 C196 190 200 214 198 236 C188 214 182 196 186 170 C192 128 186 96 168 84 Z" fill="${hairS}" opacity=".55"/>
    <path d="M176 76 C194 88 200 112 196 140" stroke="${hairH}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>
  </g>
  <!-- back hair -->
  <ellipse cx="112" cy="110" rx="72" ry="70" fill="${hairS}"/>
  <path d="M44 112 C36 160 48 196 60 212 C68 184 66 150 72 122 Z" fill="${hair}"/>
  <path d="M180 112 C188 160 176 196 164 212 C156 184 158 150 152 122 Z" fill="${hair}"/>
  <!-- body -->
  <path d="M68 290 C70 214 84 184 112 182 C140 184 154 214 156 290 Z" fill="#a4a8b3"/>
  <path d="M84 196 C92 188 102 184 112 184 C122 184 132 188 140 196 L128 206 L112 194 L96 206 Z" fill="#c9ccd4"/>
  <path d="M108 196 L116 196 L121 238 L112 248 L103 238 Z" fill="#373b46"/>
  <path d="M104.5 214 L119.5 214" stroke="${hair}" stroke-width="3"/>
  <rect x="105" y="170" width="14" height="16" rx="5" fill="${skin}"/>
  <!-- arms + flip phone -->
  <path d="M80 204 C70 222 78 240 96 238" stroke="#a4a8b3" stroke-width="15" fill="none" stroke-linecap="round"/>
  <path d="M144 204 C154 222 146 240 128 238" stroke="#a4a8b3" stroke-width="15" fill="none" stroke-linecap="round"/>
  <g class="neru-phone">
    <rect x="98" y="206" width="28" height="40" rx="5" fill="#2b2d36"/>
    <rect x="102" y="211" width="20" height="17" rx="2" class="neru-screen"/>
    <circle cx="112" cy="236" r="3" fill="#555a68"/>
    <path d="M104 216 h8 M104 221 h12" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  </g>
  <circle cx="98" cy="238" r="8" fill="${skin}"/>
  <circle cx="126" cy="238" r="8" fill="${skin}"/>
  <!-- face -->
  <ellipse cx="112" cy="118" rx="58" ry="55" fill="${skin}"/>
  <!-- eyes: smug (default) / happy (when teasing) -->
  <g class="neru-eyes-smug">
    <ellipse cx="89" cy="124" rx="10" ry="12" fill="#e0a226"/><ellipse cx="89" cy="126" rx="5" ry="7" fill="#6a3b0a"/><circle cx="86" cy="121" r="3" fill="#fff"/>
    <ellipse cx="135" cy="124" rx="10" ry="12" fill="#e0a226"/><ellipse cx="135" cy="126" rx="5" ry="7" fill="#6a3b0a"/><circle cx="132" cy="121" r="3" fill="#fff"/>
    <path d="M77 110 L101 110 L101 120 Q89 115 77 120 Z M123 110 L147 110 L147 120 Q135 115 123 120 Z" fill="${skin}"/>
    <path d="M76 120 Q89 113 102 119 M122 119 Q135 113 148 120" stroke="${line}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M78 104 Q89 100 100 105 M124 105 Q135 100 146 104" stroke="${hairS}" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <g class="neru-eyes-happy">
    <path d="M78 124 Q89 112 100 124 M124 124 Q135 112 146 124" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>
  <ellipse cx="78" cy="142" rx="10" ry="5.5" fill="#ff8fa8" opacity=".55"/>
  <ellipse cx="146" cy="142" rx="10" ry="5.5" fill="#ff8fa8" opacity=".55"/>
  <g class="neru-mouth-smirk">
    <path d="M101 146 Q112 154 124 143" stroke="#6a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M117 148 L119.5 154 L122 146.5 Z" fill="#fff" stroke="#6a2a1a" stroke-width="1"/>
  </g>
  <g class="neru-mouth-laugh">
    <path d="M100 143 Q112 162 125 143 Z" fill="#8a2f2a" stroke="#6a2a1a" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M116 144 L118.5 150 L121 144 Z" fill="#fff"/>
  </g>
  <!-- bangs + ahoge + hair tie -->
  <path d="M50 110 C46 62 78 38 112 38 C148 38 178 62 174 110 L165 94 L156 114 L146 86 L134 108 L122 82 L111 108 L100 82 L89 108 L79 86 L68 112 L60 94 Z" fill="${hair}"/>
  <path d="M70 70 C84 52 104 46 124 48" stroke="${hairH}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>
  <path d="M110 40 C100 20 122 12 126 28" stroke="${hair}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="154" cy="70" r="9" fill="#5b4bc4"/><circle cx="151" cy="67" r="3" fill="#8f82ea"/>
</svg>`;
  },
  build() {
    this.stop();
    this.bubble = h('div.neru-bubble');
    this.el = h('button.neru', { 'aria-label': 'Neru', title: 'Neru', onclick: e => { e.stopPropagation(); this.say(); } });
    this.el.innerHTML = this.svg();
    this.el.prepend(this.bubble);
    // say hi shortly after the menu appears, then tease now and then
    const greet = () => { if (Overlays.top()) { this._t = setTimeout(greet, 1500); return; } this.say(`Hi ${ProfileManager.profile.name || 'zako'}~ ready to lose? ♡`); };
    this._t = setTimeout(greet, 1800);
    this._idle = setInterval(() => { if (!document.hidden && !Overlays.top()) this.say(); }, 32000);
    return this.el;
  },
  say(text) {
    if (!this.el) return;
    let line = text;
    if (!line) { do line = this.LINES[Math.floor(Math.random() * this.LINES.length)]; while (line === this._last && this.LINES.length > 1); }
    this._last = line;
    this.bubble.textContent = line;
    this.el.classList.remove('talk'); void this.el.offsetWidth; this.el.classList.add('talk');
    clearTimeout(this._hide);
    this._hide = setTimeout(() => this.el && this.el.classList.remove('talk'), 3200);
  },
  stop() { clearTimeout(this._t); clearTimeout(this._hide); clearInterval(this._idle); this.el = null; },
};
