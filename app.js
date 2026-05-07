const STORAGE_KEY = "crc-seat-draw-state-v1";
const TABLE_COUNT = 6;
const SEATS_PER_TABLE = 8;
const MAX_PEOPLE = TABLE_COUNT * SEATS_PER_TABLE;

const units = [
  {
    id: "erjia",
    label: "兒家教保組",
    shortLabel: "兒家",
    className: "erjia",
  },
  {
    id: "shaojia",
    label: "少家教保組",
    shortLabel: "少家",
    className: "shaojia",
  },
  {
    id: "foundation",
    label: "基金會+諮商所",
    shortLabel: "基金/諮商",
    className: "foundation",
  },
];

const seatSlots = [
  { key: "top", area: "top" },
  { key: "left-1", area: "left" },
  { key: "left-2", area: "left" },
  { key: "left-3", area: "left" },
  { key: "right-1", area: "right" },
  { key: "right-2", area: "right" },
  { key: "right-3", area: "right" },
  { key: "bottom", area: "bottom" },
];

const drawForm = document.querySelector("#drawForm");
const nameInput = document.querySelector("#nameInput");
const message = document.querySelector("#message");
const tablesEl = document.querySelector("#tables");
const totalCountEl = document.querySelector("#totalCount");
const unitCountsEl = document.querySelector("#unitCounts");
const rosterEl = document.querySelector("#roster");
const simulateBtn = document.querySelector("#simulateBtn");
const rerollBtn = document.querySelector("#rerollBtn");
const clearBtn = document.querySelector("#clearBtn");

let state = loadState();

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { people: [] };
    const parsed = JSON.parse(saved);
    return { people: Array.isArray(parsed.people) ? parsed.people : [] };
  } catch {
    return { people: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function unitById(unitId) {
  return units.find((unit) => unit.id === unitId);
}

function shuffle(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

function emptyTableStats() {
  return Array.from({ length: TABLE_COUNT }, (_, tableIndex) => ({
    tableId: tableIndex + 1,
    total: 0,
    byUnit: Object.fromEntries(units.map((unit) => [unit.id, 0])),
    usedSeats: new Set(),
  }));
}

function buildTableStats(people = state.people) {
  const stats = emptyTableStats();
  people.forEach((person) => {
    if (!person.tableId) return;
    const table = stats[person.tableId - 1];
    table.total += 1;
    table.byUnit[person.unit] += 1;
    table.usedSeats.add(person.seatIndex);
  });
  return stats;
}

function firstFreeSeat(table) {
  return seatSlots.findIndex((_, index) => !table.usedSeats.has(index));
}

function assignSingle(person, people = state.people) {
  const stats = buildTableStats(people);
  const candidates = stats
    .filter((table) => table.total < SEATS_PER_TABLE && table.byUnit[person.unit] < 3)
    .map((table) => ({
      table,
      score:
        table.byUnit[person.unit] * 10 +
        table.total +
        Math.random() * 0.7,
    }))
    .sort((a, b) => a.score - b.score);

  if (!candidates.length) return null;

  const picked = candidates[0].table;
  const seatIndex = firstFreeSeat(picked);
  return { ...person, tableId: picked.tableId, seatIndex };
}

function canUseStrictQuotas(people) {
  if (people.length !== MAX_PEOPLE) return false;
  return units.every((unit) => {
    const count = people.filter((person) => person.unit === unit.id).length;
    return count >= TABLE_COUNT * 2 && count <= TABLE_COUNT * 3;
  });
}

function buildStrictQuotas(people) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const quotas = Array.from({ length: TABLE_COUNT }, () =>
      Object.fromEntries(units.map((unit) => [unit.id, 2])),
    );
    const tableExtras = Array.from({ length: TABLE_COUNT }, () => new Set());
    const extras = shuffle(
      units.flatMap((unit) => {
        const count = people.filter((person) => person.unit === unit.id).length;
        return Array.from({ length: count - TABLE_COUNT * 2 }, () => unit.id);
      }),
    );

    let valid = true;
    for (const unitId of extras) {
      const tableOrder = shuffle([...Array(TABLE_COUNT).keys()]).sort(
        (a, b) => tableExtras[a].size - tableExtras[b].size,
      );
      const tableIndex = tableOrder.find(
        (index) => tableExtras[index].size < 2 && !tableExtras[index].has(unitId),
      );

      if (tableIndex === undefined) {
        valid = false;
        break;
      }

      tableExtras[tableIndex].add(unitId);
      quotas[tableIndex][unitId] += 1;
    }

    if (valid && tableExtras.every((set) => set.size === 2)) return quotas;
  }

  return null;
}

function assignByStrictQuotas(people) {
  const quotas = buildStrictQuotas(people);
  if (!quotas) return null;

  const assigned = [];
  const seatsByTable = Array.from({ length: TABLE_COUNT }, () => shuffle([...Array(SEATS_PER_TABLE).keys()]));

  units.forEach((unit) => {
    const peopleInUnit = shuffle(people.filter((person) => person.unit === unit.id));
    let cursor = 0;
    quotas.forEach((tableQuota, tableIndex) => {
      for (let count = 0; count < tableQuota[unit.id]; count += 1) {
        const person = peopleInUnit[cursor];
        assigned.push({
          ...person,
          tableId: tableIndex + 1,
          seatIndex: seatsByTable[tableIndex].pop(),
        });
        cursor += 1;
      }
    });
  });

  return assigned;
}

function assignRoster(people) {
  const cleanPeople = people.map((person) => ({
    ...person,
    tableId: null,
    seatIndex: null,
  }));

  if (canUseStrictQuotas(cleanPeople)) {
    const strictResult = assignByStrictQuotas(cleanPeople);
    if (strictResult) return strictResult;
  }

  const ordered = shuffle(cleanPeople).sort((a, b) => {
    const countA = cleanPeople.filter((person) => person.unit === a.unit).length;
    const countB = cleanPeople.filter((person) => person.unit === b.unit).length;
    return countB - countA;
  });

  const assigned = [];
  ordered.forEach((person) => {
    const picked = assignSingle(person, assigned);
    if (picked) assigned.push(picked);
  });

  return assigned;
}

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function statusText() {
  if (state.people.length === 0) return "請輸入姓名與單位後抽籤，或先用快速排座位模擬。";
  if (state.people.length < MAX_PEOPLE) {
    return `已登記 ${state.people.length} 人。未滿 48 人時會先平均分散；滿 48 人且比例可行時，會套用每桌每單位 2-3 人規則。`;
  }

  if (!canUseStrictQuotas(state.people)) {
    return "目前已滿 48 人，但三個單位的人數需各在 12-18 人之間，才能保證每桌每單位 2-3 人。";
  }

  return "已完成 48 人排座，每桌每單位皆為 2-3 人。";
}

function render() {
  saveState();
  renderTables();
  renderStats();
  setMessage(statusText(), state.people.length === MAX_PEOPLE && canUseStrictQuotas(state.people) ? "good" : "");
}

function renderTables() {
  const stats = buildTableStats();
  tablesEl.innerHTML = "";

  stats.forEach((table) => {
    const card = document.createElement("article");
    card.className = "table-card";
    card.setAttribute("aria-label", `第 ${table.tableId} 組`);

    const peopleAtTable = state.people.filter((person) => person.tableId === table.tableId);
    const bySeat = new Map(peopleAtTable.map((person) => [person.seatIndex, person]));

    const top = createSeat(bySeat.get(0), 0, true);
    top.classList.add("top");
    card.appendChild(top);

    const leftStack = document.createElement("div");
    leftStack.className = "seat-stack left";
    [1, 2, 3].forEach((seatIndex) => leftStack.appendChild(createSeat(bySeat.get(seatIndex), seatIndex)));
    card.appendChild(leftStack);

    const tableBox = document.createElement("div");
    tableBox.className = "table-box";
    tableBox.innerHTML = `
      <div class="table-title"><span>第 ${table.tableId} 組</span><span>${table.total}/${SEATS_PER_TABLE}</span></div>
      <div class="table-summary">
        ${units
          .map(
            (unit) => `
              <div class="summary-line ${unit.className}">
                <span>${unit.shortLabel}</span>
                <strong>${table.byUnit[unit.id]}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="table-note">每組 8 人</div>
    `;
    card.appendChild(tableBox);

    const rightStack = document.createElement("div");
    rightStack.className = "seat-stack right";
    [4, 5, 6].forEach((seatIndex) => rightStack.appendChild(createSeat(bySeat.get(seatIndex), seatIndex)));
    card.appendChild(rightStack);

    const bottom = createSeat(bySeat.get(7), 7, true);
    bottom.classList.add("bottom");
    card.appendChild(bottom);

    tablesEl.appendChild(card);
  });
}

function createSeat(person, seatIndex, single = false) {
  const seat = document.createElement("div");
  seat.className = `seat ${single ? "single" : ""}`.trim();
  seat.dataset.seat = seatIndex + 1;

  if (!person) {
    seat.textContent = "空位";
    return seat;
  }

  const unit = unitById(person.unit);
  seat.classList.add("filled", unit.className);
  seat.textContent = person.name;
  seat.title = `${person.name} - ${unit.label}`;
  return seat;
}

function renderStats() {
  totalCountEl.textContent = `${state.people.length} / ${MAX_PEOPLE}`;

  unitCountsEl.innerHTML = "";
  units.forEach((unit) => {
    const count = state.people.filter((person) => person.unit === unit.id).length;
    const row = document.createElement("div");
    row.className = `count-row ${unit.className}`;
    row.innerHTML = `<span>${unit.label}</span><strong>${count}</strong>`;
    unitCountsEl.appendChild(row);
  });

  rosterEl.innerHTML = "";
  state.people
    .slice()
    .sort((a, b) => {
      if ((a.tableId || 99) !== (b.tableId || 99)) return (a.tableId || 99) - (b.tableId || 99);
      return (a.seatIndex || 0) - (b.seatIndex || 0);
    })
    .forEach((person) => {
      const unit = unitById(person.unit);
      const item = document.createElement("div");
      item.className = "roster-item";
      item.innerHTML = `
        <span>${person.name}｜${unit.shortLabel}｜第 ${person.tableId || "-"} 組</span>
        <button type="button" data-remove="${person.id}">移除</button>
      `;
      rosterEl.appendChild(item);
    });
}

drawForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const unit = new FormData(drawForm).get("unit");

  if (!name) {
    setMessage("請先輸入姓名。", "warn");
    nameInput.focus();
    return;
  }

  if (state.people.length >= MAX_PEOPLE) {
    setMessage("座位已滿 48 人，請先移除或清空資料。", "warn");
    return;
  }

  if (state.people.some((person) => person.name === name)) {
    setMessage("這個姓名已經抽過籤。", "warn");
    return;
  }

  const person = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    unit,
    tableId: null,
    seatIndex: null,
  };

  const assigned = assignSingle(person);
  if (!assigned) {
    setMessage("目前沒有符合這個單位限制的空位，請重新抽籤全部或檢查人數比例。", "warn");
    return;
  }

  state.people.push(assigned);
  nameInput.value = "";
  render();
  setMessage(`${name} 抽到第 ${assigned.tableId} 組。`, "good");
});

simulateBtn.addEventListener("click", () => {
  const samplePeople = units.flatMap((unit) =>
    Array.from({ length: 16 }, (_, index) => ({
      id: `sample-${unit.id}-${index + 1}`,
      name: `${unit.shortLabel}${String(index + 1).padStart(2, "0")}`,
      unit: unit.id,
      tableId: null,
      seatIndex: null,
    })),
  );
  state.people = assignRoster(samplePeople);
  render();
  setMessage("已建立 48 人模擬名單並完成排座。", "good");
});

rerollBtn.addEventListener("click", () => {
  if (!state.people.length) {
    setMessage("目前沒有名單可以重新抽籤。", "warn");
    return;
  }
  state.people = assignRoster(state.people);
  render();
  setMessage("已重新抽籤全部座位。", "good");
});

clearBtn.addEventListener("click", () => {
  if (!state.people.length) return;
  const confirmed = window.confirm("確定要清空目前所有抽籤資料？");
  if (!confirmed) return;
  state.people = [];
  render();
});

rosterEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  state.people = state.people.filter((person) => person.id !== button.dataset.remove);
  render();
});

render();
