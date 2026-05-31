there are 3 types of users:
admin, moderator (called mod) and basic

the revised rules are:

- admin user can create, view and edit everything (all projects, all files), but can also see all users, and other admin tasks
- mod user can create, view and edit everything, but doesnt have other admin privileges (like seeing all users etc. - not implemented for now)
- basic user can only see public files, basic user can see files that he was invited to, and if the invitation was to collaborate, he can edit them too - this should work similarly to google docs - when sending invite, the sender chooses the role for the invited user (view, edit)

if you are not sure about anything, please help me propose a solid strategy and architecture for this usecase. it should be industry standard, so take examples from other successful products and how they handle it. but it should be as simple as possible. there are 3 types of documents - private (only admin and mod and the owning user can view/edit), shared (admin and mod and owning user can view/edit and invited users can do stuff according to their invitation roles), and public (admin and mod and owning user can view/edit, everyone else regardless of the role can view, owner can add users as editors (collaborators) to this project that can edit).

validate this proposal. be critical, think of solutions, be practical, dont just blindly approve, challenge the proposal if you find loopholes or errors or bugs or problems. if we will be both happy, we will continue and implement it.

important note: this system should be then not only enforced on frontend, but also on the backend (pocketbase access control, if that exists. if it does not exist, we will migrate to supabase - do research and verify this).
