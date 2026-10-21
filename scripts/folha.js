frappe.query_reports["Folha do STDB"] = {
    filters: [
        {
            fieldname: "month",
            label: __("Mês"),
            fieldtype: "Select",
            options: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
            default: String(frappe.datetime.get_today().split("-")[1]).replace(/^0/, ""),
            reqd: 1,
        },
        {
            fieldname: "year",
            label: __("Ano"),
            fieldtype: "Int",
            default: frappe.datetime.get_today().split("-")[0],
            reqd: 1,
        },
    ],

    onload(report) {
        report.page.add_inner_button(__("📥 Download Folha STDB"), () => {
            const filters = report.get_values();
            if (!filters.month || !filters.year) {
                frappe.msgprint("Selecciona o Mês e o Ano.");
                return;
            }

            const data = report.data;
            if (!data || !data.length) {
                frappe.msgprint("Sem dados para exportar. Executa o relatório primeiro.");
                return;
            }

            const lines = data.map(row => [
                row["SEQ_NO"]                     ?? "",
                row["VALUE_DATE"]                 ?? "",
                row["REFERENCE"]                  ?? "",
                row["DESTINATION_NAME"]           ?? "",
                row["DESTINATION_SORT_CODE"]      ?? "",
                row["DESTINATION_ACCOUNT_NUMBER"] ?? "",
                row["AMOUNT"]                     ?? "",
                row["CURRENCY"]                   ?? "",
                row["DESTINATION_EMAIL"]          ?? "",
            ].join(","));

            const content  = lines.join("\n");
            const blob     = new Blob([content], { type: "text/plain;charset=utf-8" });
            const url      = URL.createObjectURL(blob);
            const a        = document.createElement("a");
            a.href         = url;
            a.download     = `folha_stdb_${filters.month}_${filters.year}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }
};
