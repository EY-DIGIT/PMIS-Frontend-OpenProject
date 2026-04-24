/* ══════════════════════════════════════════════════════════════════
   src/components/projects/MilestonePagination.jsx

   Numbered pagination footer for the milestones grid. Shows a window
   of page numbers with ellipses, Prev/Next arrows, and a page-size
   selector (5 / 10 / 20 / All).
   ══════════════════════════════════════════════════════════════════ */

import React from "react";

export default function MilestonePagination({
  total,
  page,
  totalPages,
  pageSize,
  onGoto,
  onSize,
  itemLabel = "milestone"
}) {
  const maxNumbered = 5;
  let startP = Math.max(1, page - Math.floor(maxNumbered / 2));
  let endP = Math.min(totalPages, startP + maxNumbered - 1);
  if (endP - startP + 1 < maxNumbered) {
    startP = Math.max(1, endP - maxNumbered + 1);
  }

  const numbers = [];
  for (let i = startP; i <= endP; i++) numbers.push(i);

  const rangeStart =
    total === 0 ? 0 : (page - 1) * (pageSize > 0 ? pageSize : total) + 1;
  const rangeEnd = pageSize > 0 ? Math.min(page * pageSize, total) : total;

  return (
    <div className="uidai-pagination">
      <div className="uidai-pagination__info">
        Showing {rangeStart}–{rangeEnd} of {total} {itemLabel}{total === 1 ? "" : "s"}
      </div>
      <div className="uidai-pagination__controls">
        <button
          type="button"
          className="uidai-pagination__btn"
          onClick={() => onGoto(page - 1)}
          disabled={page <= 1}
        >
          ‹ Prev
        </button>
        {startP > 1 && (
          <>
            <button type="button" className="uidai-pagination__btn" onClick={() => onGoto(1)}>
              1
            </button>
            {startP > 2 && <span className="uidai-pagination__info">…</span>}
          </>
        )}
        {numbers.map((i) => (
          <button
            key={i}
            type="button"
            className={`uidai-pagination__btn${
              i === page ? " uidai-pagination__btn--active" : ""
            }`}
            onClick={() => onGoto(i)}
          >
            {i}
          </button>
        ))}
        {endP < totalPages && (
          <>
            {endP < totalPages - 1 && <span className="uidai-pagination__info">…</span>}
            <button
              type="button"
              className="uidai-pagination__btn"
              onClick={() => onGoto(totalPages)}
            >
              {totalPages}
            </button>
          </>
        )}
        <button
          type="button"
          className="uidai-pagination__btn"
          onClick={() => onGoto(page + 1)}
          disabled={page >= totalPages}
        >
          Next ›
        </button>
      </div>
      <div className="uidai-pagination__size">
        <label htmlFor="uidai-page-size" style={{ fontWeight: 600 }}>
          Page size:
        </label>
        <select
          id="uidai-page-size"
          className="uidai-select"
          value={pageSize}
          onChange={(e) => onSize(parseInt(e.target.value, 10))}
        >
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="0">All</option>
        </select>
      </div>
    </div>
  );
}
