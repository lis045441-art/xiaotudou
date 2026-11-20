// 打卡图标：32×32，描边用 currentColor（角色描边色），.f 填角色按钮色，.w 填浅底色，.k 填描边色
const FACE = (x, y) =>
  `<circle class="k" cx="${x - 2.6}" cy="${y}" r=".9"/><circle class="k" cx="${x + 2.6}" cy="${y}" r=".9"/>` +
  `<path d="M${x - 0.9} ${y + 1.6}q.9 .8 1.8 0"/>` +
  `<ellipse class="b" cx="${x - 4.4}" cy="${y + 1.5}" rx="1.3" ry=".75"/><ellipse class="b" cx="${x + 4.4}" cy="${y + 1.5}" rx="1.3" ry=".75"/>`;

const ICONS = {
  kettle:
    '<path class="f" d="M7 15h16v4a8 8 0 0 1-8 8 8 8 0 0 1-8-8z"/>' +
    '<path d="M23 16.5h1.6a3.6 3.6 0 0 1 0 7.2H22"/>' +
    '<path d="M7.4 18.2 3.6 13.8"/>' +
    '<path class="w" d="M9.5 15v-1a5.5 5.5 0 0 1 11 0v1z"/>' +
    '<circle class="w" cx="15" cy="7.4" r="1.4"/>' +
    FACE(15, 20.5),
  cup:
    '<path class="water" d="M16 2.6c2.1 2.5 3.2 4.1 3.2 5.4a3.2 3.2 0 0 1-6.4 0c0-1.3 1.1-2.9 3.2-5.4z"/>' +
    '<path class="f" d="M8 13h16l-1.5 12.4a2.6 2.6 0 0 1-2.6 2.3h-7.8a2.6 2.6 0 0 1-2.6-2.3z"/>' +
    FACE(16, 19),
  toilet:
    '<rect class="w" x="7.5" y="4.5" width="11" height="9" rx="2.2"/>' +
    '<path class="w" d="M11 22.5 10 27.5h10l-1-5"/>' +
    '<path class="f" d="M5.5 13.5h20c0 5-3.8 9-9 9h-2c-5.2 0-9-4-9-9z"/>' +
    FACE(15.5, 17),
  roll:
    '<path class="w" d="M6.5 8v14.5a8.5 3.2 0 0 0 17 0V8"/>' +
    '<ellipse class="w" cx="15" cy="8" rx="8.5" ry="3.2"/>' +
    '<ellipse class="f" cx="15" cy="8" rx="2.8" ry="1.1"/>' +
    // 从纸卷底边垂下来的一截纸，末端锯齿撕口
    '<path class="w" d="M16.5 25.7Q20.8 25 23.5 22.5V29.6l-1.1 1-1.1-1-1.1 1-1.1-1-1.1 1-1.1-1-.8.8z"/>' +
    '<path class="dash" d="M17.4 27.4Q20.6 26.9 22.7 25.4"/>' +
    FACE(13.6, 15.4),
  chat:
    '<path class="w" d="M17 4h9a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-.5v3.2L22 15.5h-5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/>' +
    '<circle class="k" cx="20.8" cy="9.8" r=".95"/><circle class="k" cx="23.2" cy="9.8" r=".95"/><circle class="k" cx="25.6" cy="9.8" r=".95"/>' +
    '<path class="f" d="M6 11h11a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5h-7l-4 4v-4a3.5 3.5 0 0 1-3.5-3.5v-6A3.5 3.5 0 0 1 6 11z"/>' +
    FACE(11.5, 17),
  steps:
    '<ellipse class="f" cx="11" cy="15.5" rx="3.4" ry="5" transform="rotate(-12 11 15.5)"/>' +
    '<circle class="f" cx="8.2" cy="8.3" r="1.15"/><circle class="f" cx="10.6" cy="7.3" r="1.15"/><circle class="f" cx="13" cy="7.6" r="1.15"/>' +
    '<ellipse class="f" cx="21.5" cy="22" rx="3.4" ry="5" transform="rotate(12 21.5 22)"/>' +
    '<circle class="f" cx="19" cy="14.6" r="1.15"/><circle class="f" cx="21.4" cy="13.6" r="1.15"/><circle class="f" cx="23.8" cy="14.3" r="1.15"/>',
  stretch:
    '<path d="M13.5 14.5 8.5 6.5M18.5 14.5l5-8"/>' +
    '<path d="M14 21l-3 6.5M18 21l3 6.5"/>' +
    '<rect class="f" x="12" y="13" width="8" height="9" rx="3.5"/>' +
    '<circle class="w" cx="16" cy="8.6" r="4"/>' +
    '<circle class="k" cx="14.6" cy="8.4" r=".7"/><circle class="k" cx="17.4" cy="8.4" r=".7"/>' +
    '<path d="M15.2 10.2q.8 .7 1.6 0"/>' +
    '<path class="spark" d="M5 11.5v2.6M3.7 12.8h2.6M27 11.5v2.6M25.7 12.8h2.6"/>',
  parcel:
    '<path class="w" d="M4.5 11 16 6l11.5 5L16 16z"/>' +
    '<path class="f" d="M4.5 11 16 16v11.5L4.5 22.5z"/>' +
    '<path class="f" d="M27.5 11 16 16v11.5l11.5-5z"/>' +
    '<path class="k2" d="M10 8.6l11.6 5.1v4.4"/>' +
    FACE(10.3, 19),
  onigiri:
    '<path class="w" d="M16 4.5c2.6 0 11.5 13 11.5 17.2 0 3.4-3.2 5.8-11.5 5.8S4.5 25.1 4.5 21.7C4.5 17.5 13.4 4.5 16 4.5z"/>' +
    '<rect class="k" x="11.5" y="20.3" width="9" height="7.2" rx="1.2"/>' +
    FACE(16, 15.5),
};

function iconSvg(name, cls = 'ic') {
  const body = ICONS[name];
  return body ? `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>` : '';
}
