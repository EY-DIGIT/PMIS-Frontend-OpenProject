{/* Holiday List Upload */}
{showHolidayPopup && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}
  >
    <div
      style={{
        width: 450,
        background: "#fff",
        borderRadius: 8,
        padding: 24,
      }}
    >
      <h3>Upload Holiday List</h3>

      <div style={{ marginTop: 20 }}>
        <label>Year</label>
        <select
          value={holidayYear}
          onChange={(e) => setHolidayYear(e.target.value)}
          className="uidai-select"
        >
          <option value="" disabled>
            Select Year
          </option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 15 }}>
        <label>Holiday Excel</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setHolidayFile(e.target.files[0])}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 25,
        }}
      >
        <button
          className="uidai-btn uidai-btn--cancel"
          onClick={() => setShowHolidayPopup(false)}
        >
          Cancel
        </button>

        <button
          className="uidai-btn"
          onClick={handleHolidayUpload}
          disabled={uploadingHoliday}
        >
          {uploadingHoliday ? "Uploading..." : "Upload"}
        </button>
      </div>
    </div>
  </div>
)}