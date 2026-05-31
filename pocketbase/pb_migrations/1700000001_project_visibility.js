/// <reference path="../pb_data/types.d.ts" />

// Per-project visibility / access control.
//   private (default) -> only admins can see it
//   public            -> everyone can see it (anonymous, viewer, editor, admin)
//   shared            -> admins + the specific users listed in `sharedUsers` (any role)
// Folders/documents/media inherit their project's visibility via relation traversal.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')

  // ---- projects: add visibility + sharedUsers, and gate read on them ----
  const projects = app.findCollectionByNameOrId('projects')
  projects.fields.add(new SelectField({ name: 'visibility', maxSelect: 1, values: ['private', 'public', 'shared'] }))
  projects.fields.add(
    new RelationField({ name: 'sharedUsers', required: false, maxSelect: 999, collectionId: users.id, cascadeDelete: false }),
  )
  const projRead =
    '@request.auth.role = "admin" || visibility = "public" || (visibility = "shared" && sharedUsers.id ?= @request.auth.id)'
  projects.listRule = projRead
  projects.viewRule = projRead
  app.save(projects)

  // Keep existing projects visible (make them public). New projects default to private (set by the app).
  const existing = app.findRecordsByFilter('projects', "id != ''", '', 500, 0)
  for (const r of existing) {
    r.set('visibility', 'public')
    app.save(r)
  }

  // ---- folders + documents: inherit the parent project's visibility ----
  const childRead =
    '@request.auth.role = "admin" || project.visibility = "public" || (project.visibility = "shared" && project.sharedUsers.id ?= @request.auth.id)'
  for (const name of ['folders', 'documents']) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = childRead
    c.viewRule = childRead
    app.save(c)
  }

  // ---- media: inherit via its document's project ----
  const media = app.findCollectionByNameOrId('media')
  const mediaRead =
    '@request.auth.role = "admin" || document.project.visibility = "public" || (document.project.visibility = "shared" && document.project.sharedUsers.id ?= @request.auth.id)'
  media.listRule = mediaRead
  media.viewRule = mediaRead
  app.save(media)
}, (app) => {
  // revert: public read everywhere, drop the new fields
  for (const name of ['projects', 'folders', 'documents', 'media']) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = ''
    c.viewRule = ''
    app.save(c)
  }
  const projects = app.findCollectionByNameOrId('projects')
  try {
    projects.fields.removeByName('visibility')
    projects.fields.removeByName('sharedUsers')
    app.save(projects)
  } catch (e) {
    // ignore
  }
})
