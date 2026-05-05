import { createRouter, createWebHashHistory } from "vue-router";
import TicketList from "@/pages/TicketList.vue";
import TicketDetail from "@/pages/TicketDetail.vue";
import NewTicket from "@/pages/NewTicket.vue";

export default createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/",            component: TicketList  },
        { path: "/tickets/:id", component: TicketDetail },
        { path: "/new",         component: NewTicket   },
    ],
    scrollBehavior: () => ({ top: 0 }),
});
