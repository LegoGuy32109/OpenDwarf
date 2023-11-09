extends Node

class_name XMLData

#@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

enum NodeType {NODE_NONE, NODE_ELEMENT, NODE_ELEMENT_END, NODE_TEXT, 
NODE_COMMENT, NODE_CDATA, NODE_UNKNOWN}

const NODE_FIELD = "node_name"
const CHILDREN_FIELD = "children"
const PRESET_RULES = {
	"connection": {
		"attributes": [
			"type",
		],
		"children": [
			"vessel",
		],
	}
}

func getNodeTypeName(nodeType: int):
	return NodeType.keys()[nodeType]

func getAllAttributes(parser: XMLParser)->String:
	var output = ""
	for i in parser.get_attribute_count():
		output += "%s: %s	" % [parser.get_attribute_name(i), parser.get_attribute_value(i)]

	return output

## get all attributes out of an XML element, could be NODE_ELEMENT or NODE_TEXT
func getAttributes(parser: XMLParser) -> Dictionary:
	var output := {}
	for i in parser.get_attribute_count():
		output[parser.get_attribute_name(i)] = parser.get_attribute_value(i)
	output[NODE_FIELD] = parser.get_node_name()
	return output

func getAllNodeInfo(parser: XMLParser)->String:
	var output = ""
	var nodeType = parser.get_node_type()
	
	if nodeType == XMLParser.NODE_ELEMENT \
		|| nodeType == XMLParser.NODE_ELEMENT_END \
		|| nodeType == XMLParser.NODE_COMMENT \
		|| nodeType == XMLParser.NODE_CDATA:
		output += "<%s>\n" % parser.get_node_name()
	
	output += "%s\nIs Empty: %s\n%s\nOn line: %s, offset: %s" % [
		getNodeTypeName(nodeType),
		parser.is_empty(),
		getAllAttributes(parser),
		parser.get_current_line()+1,
		parser.get_node_offset()
	]
	
	if nodeType == XMLParser.NODE_TEXT:
		var text: String = parser.get_node_data()
		output += "\nText data: '%s' length: %s" % [text, text.length()]
	
	return output

## read XML file and create a body dictionary
func readBodyFile(filepath: String): # return custom error probably
	var file = FileAccess.open(filepath, FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open(filepath)
	if error != OK:
		print("error with opening file, %s" % error_string(error))
		return
	
	var root: = {}
	var nodeStack: = []
	var currentNodeName: String = ""
	
	var presets: = {}
	
	while true:
		var nodeError = parser.read() 
		if nodeError != OK:
			if nodeError == ERR_FILE_EOF:
				break
			print("error with data, %s" % error_string(nodeError)) 
			return

		if parser.get_node_type() == XMLParser.NODE_ELEMENT:
			currentNodeName = parser.get_node_name()
			var attributes: Dictionary =  getAttributes(parser)
			
			if parser.is_empty():
				if not nodeStack.back().has(CHILDREN_FIELD):
					nodeStack.back()[CHILDREN_FIELD] = []
				nodeStack.back()[CHILDREN_FIELD].push_back(attributes)
			else:
				nodeStack.push_back(attributes)
		
		if parser.get_node_type() == XMLParser.NODE_ELEMENT_END:
			var nodeName: String = parser.get_node_name()
			var poppedNode = nodeStack.pop_back()
			if nodeStack.is_empty():
				root = poppedNode
				break
			if not nodeStack.back().has(CHILDREN_FIELD):
				nodeStack.back()[CHILDREN_FIELD] = []
			
			# apply preset to node
			if poppedNode.has("preset"):
				setPreset(poppedNode, presets)
#			print(JSON.stringify(poppedNode, " ", false))
			
			nodeStack.back()[CHILDREN_FIELD].push_back(poppedNode)
	
	print(JSON.stringify(presets, " ", false))

## Given dictionary that has preset field, if the preset does not yet exist it's attributes and children will be saved as a preset according to the PRESET_RULES
func setPreset(node: Dictionary, existingPresets: Dictionary):
	if existingPresets.has(node["preset"]):
		# push preset attributes into node
		var nodePreset = existingPresets[node["preset"]]
		for key in nodePreset.keys():
			node[key] = nodePreset[key]
		# push preset children into node
		if nodePreset.has(CHILDREN_FIELD):
			if not node.has(CHILDREN_FIELD):
				node[CHILDREN_FIELD] = []
			node[CHILDREN_FIELD].append_array(nodePreset[CHILDREN_FIELD])
		return
	
	var presetAttributes := {}
	if PRESET_RULES.has(node[NODE_FIELD]):
		# save attributes to preset
		for attrName in PRESET_RULES[node[NODE_FIELD]].attributes:
			presetAttributes[attrName] = node[attrName]
		# save children to preset
		if node.has("children"):
			presetAttributes.children = []
			for child in node.children:
				if child[NODE_FIELD] in PRESET_RULES[node[NODE_FIELD]].children: 
					presetAttributes.children.push_back(child)
	else:
		presetAttributes = node
	existingPresets[node["preset"]] = presetAttributes
	
func run():
	# Just to flex, also get the text content of the file
	var file = FileAccess.open("res://_extra/xmlTest.xml", FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open("res://_extra/xmlTest.xml")
	if error != OK:
		print("error with opening file, %s" % error_string(error))
		return
	
	while true:
		var nodeError = parser.read()
		if nodeError != OK:
			print("error with data, %s" % error_string(nodeError)) 
			return
		
		print("<==\n%s\n'%s'\n==/>" % [
			getAllNodeInfo(parser),
			fileLines[parser.get_current_line()].replace('\r', '')
		])
