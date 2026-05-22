#let cv_file = sys.inputs.at("cv", default: none)
#let cv = if cv_file == none {
  panic("Missing required input: pass --input cv=<path-to-yaml>")
} else {
  yaml(cv_file)
}

#let present(value) = value != none and value != ""
#let visible(item) = item.at("visible", default: true) != false
#let join(values) = values.join(", ")

#let section(title, body) = [
  #v(0.8em)
  #text(weight: "bold", size: 11pt)[#upper(title)]
  #v(0.25em)
  #body
]

#let bullet_list(items) = [
  #list(
    tight: true,
    ..items.map(item => [#item]),
  )
]

#let date_range(item) = {
  let start = str(item.start)
  let end = item.at("end", default: none)
  if present(end) {
    start + " - " + str(end)
  } else {
    start + " - present"
  }
}

#set page(paper: "a4", margin: 1.7cm)
#set text(size: 10pt)
#set par(justify: false, leading: 0.55em)

#align(center)[
  #text(size: 18pt, weight: "bold")[#cv.contact.name #cv.contact.surname]
  #linebreak()
  #cv.contact.email
  #if present(cv.contact.at("phone", default: none)) [
    #if present(cv.contact.phone.at("prefix", default: none)) [ | +#cv.contact.phone.prefix #cv.contact.phone.number]
  ]
  #if present(cv.contact.at("linkedin", default: none)) [ | linkedin.com/in/#cv.contact.linkedin]
  #if present(cv.contact.at("github", default: none)) [ | github.com/#cv.contact.github]
  #if present(cv.contact.at("www", default: none)) [ | #cv.contact.www]
]

#section("Summary")[
  #cv.summary
]

#section("Experience")[
  #for job in cv.experience [
    #if visible(job) [
      #for position in job.positions [
        #text(weight: "bold")[#join(position.roles)] #h(1fr) #date_range(position)
        #linebreak()
        #job.company
        #if present(position.at("location", default: none)) [ -- #position.location]
        #bullet_list(position.tasks)
        #if position.at("keywords", default: ()).len() > 0 [
          #text(size: 9pt)[Keywords: #join(position.keywords)]
        ]
        #v(0.45em)
      ]
    ]
  ]
]

#if cv.at("projects", default: none) != none and cv.projects.at("items", default: ()).len() > 0 {
  section("Projects")[
    #for project in cv.projects.items [
      #if visible(project) [
        #text(weight: "bold")[#project.name]
        #if present(project.at("url", default: none)) [ -- #project.url]
        #linebreak()
        #project.summary
        #if project.at("keywords", default: ()).len() > 0 [
          #linebreak()
          #text(size: 9pt)[Keywords: #join(project.keywords)]
        ]
        #v(0.45em)
      ]
    ]
  ]
}

#if cv.at("education", default: ()).len() > 0 {
  section("Education")[
    #for item in cv.education [
      #text(weight: "bold")[#item.name]
      #if present(item.at("issuer", default: none)) [ -- #item.issuer]
      #if present(item.at("year", default: none)) [ (#item.year)]
      #linebreak()
    ]
  ]
}

#if cv.at("certifications", default: ()).len() > 0 {
  section("Certifications")[
    #for item in cv.certifications [
      #item.name
      #if present(item.at("issuer", default: none)) [ -- #item.issuer]
      #if present(item.at("year", default: none)) [ (#item.year)]
      #linebreak()
    ]
  ]
}

#if cv.at("languages", default: ()).len() > 0 {
  section("Languages")[
    #join(cv.languages.map(item => item.name + " (" + item.level + ")"))
  ]
}
