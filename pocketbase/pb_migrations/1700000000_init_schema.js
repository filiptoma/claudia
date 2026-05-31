/// <reference path="../pb_data/types.d.ts" />

// Claudia — initial schema.
// Collections: users (auth) + projects, folders, documents, media (base).
// Public read everywhere ("" = anyone). editor/admin write. Role-escalation blocked
// on BOTH create and update so a sign-up cannot self-elevate.
migrate((app) => {
  const EDIT = "@request.auth.role = 'editor' || @request.auth.role = 'admin'"

  // ---- users: add role + name; lock down rules ----
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new SelectField({ name: "role", maxSelect: 1, values: ["viewer", "editor", "admin"] }))
  users.fields.add(new TextField({ name: "name", max: 100 }))
  users.listRule   = "@request.auth.role = 'admin'"
  users.viewRule   = "@request.auth.id = id || @request.auth.role = 'admin'"   // self-or-admin
  users.createRule = "@request.body.role:isset = false"                        // sign-up, no self-elevation
  users.updateRule = "@request.auth.id = id && @request.body.role:isset = false"
  users.deleteRule = "@request.auth.role = 'admin'"
  app.save(users)

  // NOTE: empty-string ("") rules MUST be set via property assignment, NOT in the
  // `new Collection({...})` constructor object — in PB v0.39 the constructor drops ""
  // to null (which means "superusers only"), silently breaking public read. Property
  // assignment below applies "" correctly (verified against the running API).
  const publicRead = (c) => { c.listRule = ""; c.viewRule = "" }
  const editWrite = (c) => { c.createRule = EDIT; c.updateRule = EDIT; c.deleteRule = EDIT }

  // ---- projects ----
  const projects = new Collection({
    type: "base", name: "projects",
    fields: [
      new TextField({ name: "name", required: true, max: 200 }),
      new TextField({ name: "slug", required: true, max: 200 }),
      new NumberField({ name: "order" }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_projects_slug ON projects (slug)"],
  })
  publicRead(projects); editWrite(projects)
  app.save(projects)

  // ---- folders ----
  const folders = new Collection({
    type: "base", name: "folders",
    fields: [
      new TextField({ name: "name", required: true, max: 200 }),
      new TextField({ name: "slug", required: true, max: 200 }),
      new RelationField({ name: "project", required: true, maxSelect: 1, collectionId: projects.id, cascadeDelete: true }),
      new NumberField({ name: "order" }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_folders_project_slug ON folders (project, slug)"],
  })
  publicRead(folders); editWrite(folders)
  app.save(folders)

  // ---- documents ----
  const documents = new Collection({
    type: "base", name: "documents",
    fields: [
      new TextField({ name: "title", required: true, max: 300 }),
      new TextField({ name: "slug", required: true, max: 300 }),
      new RelationField({ name: "project", required: true, maxSelect: 1, collectionId: projects.id, cascadeDelete: true }),
      new RelationField({ name: "folder", required: false, maxSelect: 1, collectionId: folders.id, cascadeDelete: true }),
      new TextField({ name: "content" }),               // markdown, no max
      new NumberField({ name: "order" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_documents_project_slug ON documents (project, slug)"],
  })
  publicRead(documents); editWrite(documents)
  app.save(documents)

  // ---- media ----
  const media = new Collection({
    type: "base", name: "media",
    fields: [
      new FileField({ name: "file", required: true, maxSelect: 1, maxSize: 5242880,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] }),
      new RelationField({ name: "document", required: false, maxSelect: 1, collectionId: documents.id, cascadeDelete: false }),
      new TextField({ name: "alt", max: 300 }),
    ],
  })
  publicRead(media); editWrite(media)
  app.save(media)
}, (app) => {
  for (const n of ["media", "documents", "folders", "projects"]) {
    try { app.delete(app.findCollectionByNameOrId(n)) } catch (_) {}
  }
})
