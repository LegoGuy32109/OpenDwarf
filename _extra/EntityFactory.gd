extends Resource

class_name EntityFactory

## Take one time functions to establish networks and properties in Body, and put them here returning a Body object`

enum SPECIES {
	HUMAN_MALE, 
	HUMAN_FEMALE, 
	DWARF_MALE, 
	DWARF_FEMALE,
	SCRAPLIN
}

@export_dir var templatesDir: String = "res://Game/Creature/templates"

var templates: Dictionary = {
	SPECIES.HUMAN_MALE: "human_male_template.json",
}

var template: Dictionary

func _init(species: SPECIES) -> void:
	var templatePath: String = "%s/%s" % [templatesDir, templates[species]]
	var file = FileAccess.open(templatePath, FileAccess.READ)
	template = JSON.parse_string(file.get_as_text())
	
	print("Created %s Factory" % [SPECIES.keys()[species]])
	print(template)
