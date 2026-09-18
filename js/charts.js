// 그래프. 색은 CSS 변수에서 읽어 오므로 다크 모드에서도 같은 코드가 동작한다.
import { won, manwon } from './model.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const charts = new Map();

function theme() {
  return {
    surface: css('--surface-1'),
    line: css('--line'),
    text: css('--text-primary'),
    sub: css('--text-secondary'),
    muted: css('--text-muted'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--series-${i}`)),
  };
}

function base(t) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 8, right: 8 } },
    plugins: {
      legend: {
        position: 'top', align: 'start',
        labels: { boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, color: t.sub, font: { size: 12 }, padding: 14 },
      },
      tooltip: {
        backgroundColor: t.text, titleColor: t.surface, bodyColor: t.surface, padding: 10,
        cornerRadius: 8, displayColors: true, boxWidth: 8, boxHeight: 8, boxPadding: 4,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${won(c.parsed.y ?? c.parsed.x)}` },
      },
    },
  };
}

function destroy(id) {
  if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }
}

/** 월별 소비(고정비/변동비 누적 막대) + 수입(선) */
export function monthlyChart(canvas, { labels, fixed, variable, income, onPick }) {
  const t = theme();
  destroy(canvas.id);
  const c = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: '고정비', data: fixed, backgroundColor: t.series[0],
          borderColor: t.surface, borderWidth: 2, borderRadius: 4, borderSkipped: false,
          stack: 'spend', maxBarThickness: 46,
        },
        {
          type: 'bar', label: '변동비', data: variable, backgroundColor: t.series[1],
          borderColor: t.surface, borderWidth: 2, borderRadius: 4, borderSkipped: false,
          stack: 'spend', maxBarThickness: 46,
        },
        {
          type: 'line', label: '정기 수입', data: income, borderColor: t.series[6], borderWidth: 2,
          backgroundColor: t.surface, pointBackgroundColor: t.series[6], pointBorderColor: t.surface,
          pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7, tension: .25, fill: false,
        },
      ],
    },
    options: {
      ...base(t),
      onClick: (evt, els, chart) => {
        if (!onPick) return;
        // 누른 조각(고정비/변동비/수입) 하나만 찾는다
        const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true)[0] || els[0];
        if (hit) onPick(hit.index, hit.datasetIndex);
      },
      onHover: (evt, els) => { evt.native.target.style.cursor = onPick && els.length ? 'pointer' : 'default'; },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: t.line }, ticks: { color: t.sub, font: { size: 12 } } },
        y: {
          stacked: true, beginAtZero: true,
          grid: { color: t.line, drawTicks: false },
          border: { display: false },
          ticks: { color: t.muted, font: { size: 11 }, callback: (v) => manwon(v) },
        },
      },
    },
  });
  charts.set(canvas.id, c);
  return c;
}

/** 카테고리별 가로 막대 — 값은 막대 끝에 직접 표시 */
export function categoryChart(canvas, rows, { compare = null, onPick } = {}) {
  const t = theme();
  destroy(canvas.id);
  const labelPlugin = {
    id: 'endLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 11px -apple-system, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const v = rows[i].amount;
        if (!v) return;
        ctx.fillStyle = t.sub;
        ctx.textAlign = 'left';
        let text = manwon(v);
        if (compare) {
          const d = v - (compare.get(rows[i].id) || 0);
          if (Math.abs(d) >= 10000) text += `  (${d > 0 ? '▲' : '▼'}${manwon(Math.abs(d))})`;
        }
        ctx.fillText(text, bar.x + 8, bar.y);
      });
      ctx.restore();
    },
  };
  const c = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{
        label: '소비', data: rows.map((r) => r.amount),
        backgroundColor: rows.map((r) => (r.major === '고정비' ? t.series[0] : r.major === '일회성' ? t.series[3] : t.series[1])),
        borderRadius: 4, borderSkipped: false, maxBarThickness: 20,
      }],
    },
    options: {
      ...base(t),
      onClick: (evt, els) => {
        if (!onPick || !els.length) return;
        onPick(rows[els[0].index]);
      },
      onHover: (evt, els) => { evt.native.target.style.cursor = onPick && els.length ? 'pointer' : 'default'; },
      indexAxis: 'y',
      layout: { padding: { right: 96 } },
      plugins: {
        ...base(t).plugins,
        legend: { display: false },
        tooltip: { ...base(t).plugins.tooltip, callbacks: { label: (c2) => ` ${won(c2.parsed.x)}` } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: t.line, drawTicks: false }, border: { display: false }, ticks: { color: t.muted, font: { size: 11 }, callback: (v) => manwon(v) } },
        y: { grid: { display: false }, border: { color: t.line }, ticks: { color: t.text, font: { size: 12 } } },
      },
    },
    plugins: [labelPlugin],
  });
  charts.set(canvas.id, c);
  return c;
}

/** 투자: 투입 원금 vs 평가금액 */
export function investChart(canvas, rows) {
  const t = theme();
  destroy(canvas.id);
  const c = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [
        { label: '투입 원금', data: rows.map((r) => r.principal), backgroundColor: t.series[0], borderRadius: 4, borderSkipped: false, maxBarThickness: 40 },
        { label: '현재 평가', data: rows.map((r) => r.value), backgroundColor: t.series[2], borderRadius: 4, borderSkipped: false, maxBarThickness: 40 },
      ],
    },
    options: {
      ...base(t),
      scales: {
        x: { grid: { display: false }, border: { color: t.line }, ticks: { color: t.sub, font: { size: 12 } } },
        y: { beginAtZero: true, grid: { color: t.line, drawTicks: false }, border: { display: false }, ticks: { color: t.muted, font: { size: 11 }, callback: (v) => manwon(v) } },
      },
    },
  });
  charts.set(canvas.id, c);
  return c;
}

/** 대출 잔액이 줄어드는 모습 */
export function loanChart(canvas, series) {
  const th = theme();
  destroy(canvas.id);
  const c = new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: series.sets.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: th.series[i % th.series.length],
        backgroundColor: th.surface,
        pointBackgroundColor: th.series[i % th.series.length],
        pointBorderColor: th.surface,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        borderDash: s.dashed ? [6, 4] : undefined,
        tension: .15,
        fill: false,
      })),
    },
    options: {
      ...base(th),
      plugins: { ...base(th).plugins, legend: { ...base(th).plugins.legend, display: series.sets.length > 1 } },
      scales: {
        x: { grid: { display: false }, border: { color: th.line }, ticks: { color: th.sub, font: { size: 11 }, maxTicksLimit: 8 } },
        y: { beginAtZero: true, grid: { color: th.line, drawTicks: false }, border: { display: false }, ticks: { color: th.muted, font: { size: 11 }, callback: (v) => manwon(v) } },
      },
    },
  });
  charts.set(canvas.id, c);
  return c;
}

