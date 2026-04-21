import React from 'react';

export default function PaginationBar({ total, page, pageSize, totalPages, onPage, onPageSize }) {
  if (total === 0) return null;

  const maxNumbered = 5;
  let startP = Math.max(1, page - Math.floor(maxNumbered / 2));
  let endP = Math.min(totalPages, startP + maxNumbered - 1);
  if (endP - startP + 1 < maxNumbered) startP = Math.max(1, endP - maxNumbered + 1);

  const numberBtns = [];
  for (let i = startP; i <= endP; i++) {
    numberBtns.push(
      <button key={i}
        className={`pmis-page-btn ${i === page ? 'pmis-page-btn-active' : ''}`}
        onClick={() => onPage(i)}
      >{i}</button>
    );
  }

  const rangeStart = total === 0 ? 0 : ((page - 1) * (pageSize > 0 ? pageSize : total)) + 1;
  const rangeEnd = pageSize > 0 ? Math.min(page * pageSize, total) : total;

  return (
    <div className="pmis-pagination">
      <div className="pmis-page-info">
        Showing {rangeStart}–{rangeEnd} of {total} milestone{total === 1 ? '' : 's'}
      </div>
      <div className="pmis-page-controls">
        <button className="pmis-page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
        {startP > 1 && (
          <>
            <button className="pmis-page-btn" onClick={() => onPage(1)}>1</button>
            {startP > 2 && <span className="pmis-page-info">…</span>}
          </>
        )}
        {numberBtns}
        {endP < totalPages && (
          <>
            {endP < totalPages - 1 && <span className="pmis-page-info">…</span>}
            <button className="pmis-page-btn" onClick={() => onPage(totalPages)}>{totalPages}</button>
          </>
        )}
        <button className="pmis-page-btn" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next ›</button>
      </div>
      <div className="pmis-page-size">
        <label className="pmis-page-size-label">Page size:</label>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(parseInt(e.target.value, 10) || 0)}
          className="pmis-page-size-select"
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={0}>All</option>
        </select>
      </div>
    </div>
  );
}
