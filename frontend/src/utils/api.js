const APP = "entre_erp.api";

function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)frappe_csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "fetch";
}

async function call(method, args = {}) {
    const res = await fetch(`/api/method/${APP}.${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": getCsrfToken(),
        },
        body: JSON.stringify(args),
    });

    const data = await res.json();

    if (data.exc) {
        let message = "An unexpected error occurred.";
        try {
            const msgs = JSON.parse(data._server_messages ?? "[]");
            if (msgs.length) message = JSON.parse(msgs[0]).message;
        } catch {}
        throw new Error(message);
    }

    return data.message;
}

export const api = {
    getIssues: (page = 1, status = null) =>
        call("get_portal_issues", { page, status }),

    getIssue: (issueId) =>
        call("get_portal_issue", { issue_id: issueId }),

    createIssue: (subject, description, priority) =>
        call("create_portal_issue", { subject, description, priority }),

    addReply: (issueId, content) =>
        call("add_portal_reply", { issue_id: issueId, content }),
};
