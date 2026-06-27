import { areJidsSameUser, jidNormalizedUser } from "baileys";
import { findParticipant } from "#libs/utils/group";
import { isOwner } from "#libs/utils/permission";

/**
 * Thrown by a guard when the command should be blocked.
 * The middleware catches this and sends the message to the user.
 */
export class GuardError extends Error {
    constructor(message) {
        super(message);
        this.name = "GuardError";
    }
}

/**
 * @param {import('./Interaction.js').Interaction} i
 */
const requireGroup = (i) => {
    if (!i.isGroup) {
        throw new GuardError("Group only.");
    }
};

/**
 * Built-in guards. Register a guard by name in CommandBuilder.setGuard()
 * and it will run before the command handler.
 *
 * @type {Record<string, (i: import('./Interaction.js').Interaction) => void | Promise<void>>}
 */
export const GUARDS = {
    owner(i) {
        if (!isOwner(i)) {
            throw new GuardError("Owner only.");
        }
    },

    premium(i) {
        if (isOwner(i)) {
            return;
        }
        if (!i.isPremium) {
            throw new GuardError("Premium user only.");
        }
    },

    group: requireGroup,

    private(i) {
        if (i.isGroup) {
            throw new GuardError("Private chat only.");
        }
    },

    async admin(i) {
        requireGroup(i);
        const meta = await i.getGroupMeta();
        const user = i.msg.key.participant || i.msg.key.remoteJid;
        if (!findParticipant(meta, user)?.admin) {
            throw new GuardError("Admin only.");
        }
    },

    async botAdmin(i) {
        requireGroup(i);
        const meta = await i.getGroupMeta();
        const botJid = i.sock.user?.id;
        const normalized = jidNormalizedUser(botJid);
        const botLid = i.sock.user?.lid;

        const botIsAdmin = meta?.participants?.some((p) => {
            if (!p.admin) {
                return false;
            }
            try {
                if (
                    p.id === botJid ||
                    p.id === normalized ||
                    (botLid && p.id === botLid) ||
                    areJidsSameUser(p.id, botJid) ||
                    (botLid && areJidsSameUser(p.id, botLid))
                ) {
                    return true;
                }
            } catch {}
            return false;
        });

        if (!botIsAdmin) {
            throw new GuardError("Bot must be admin.");
        }
    },
};
