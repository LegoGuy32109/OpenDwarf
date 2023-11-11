extends Node

class_name XMLData

#@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

# will be used for debugging purposes
enum NodeType {NODE_NONE, NODE_ELEMENT, NODE_ELEMENT_END, NODE_TEXT, 
NODE_COMMENT, NODE_CDATA, NODE_UNKNOWN}
func getNodeTypeName(nodeType: int):
	return NodeType.keys()[nodeType]

const NODE_FIELD = "node_name"
const CHILDREN_FIELD = "children"
const PRESET_FIELD = "preset"
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

## Get all attributes out of an XML element, could be NODE_ELEMENT or NODE_TEXT
func getAttributes(parser: XMLParser) -> Dictionary:
	var output := {}
	for i in parser.get_attribute_count():
		output[parser.get_attribute_name(i)] = parser.get_attribute_value(i)
	output[NODE_FIELD] = parser.get_node_name()
	return output

## Save JSON data as an xml document
func saveToFile(data: Dictionary, filePath: String):
	var output := "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n"
	
	if not data.has(NODE_FIELD):
		printerr()
		printerr("'%s' not found in data" % NODE_FIELD)
		return
	
	output += _parseData(data)
	
	var file = FileAccess.open(filePath, FileAccess.WRITE)
	file.store_string(output)
	file.close()
	print("file successfully saved at %s" % filePath)

func _parseData(data: Dictionary, indent: String = "")->String:
	var output := ""
	
	if not data.has(NODE_FIELD):
		printerr()
		printerr("'%s' not found in data" % NODE_FIELD)
		return ""
	
	output += "<%s\n" % [data[NODE_FIELD]]
	var keys = data.keys()
	keys.erase(NODE_FIELD)
	keys.erase(CHILDREN_FIELD)
	for key in keys:
		output+="%s	%s=\"%s\"\n" % [indent, key, data[key]]
	output += "%s>\n" % indent
	
	if data.has("children"):
		for child in data.children:
			output += "%s	%s" % [indent, _parseData(child, indent+"	")]
	
	output += "%s</%s>\n" % [indent, data[NODE_FIELD]]
	
	return output

## Read XML file and create a dictionary representing body data 
func readBodyFile(filepath: String)-> Dictionary: # return custom error probably
	var file = FileAccess.open(filepath, FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open(filepath)
	if error != OK:
		printerr("error with opening file, %s" % error_string(error))
		return {}
	
	var root: = {}
	var nodeStack: Array[Dictionary] = []
	var currentNodeName: String
	
	## if current open node doesn't have 'children' attribute yet, create one then add child
	var _mergeChildInStack = func(child: Dictionary):
		if not nodeStack.back().has(CHILDREN_FIELD):
			nodeStack.back()[CHILDREN_FIELD] = []
		nodeStack.back()[CHILDREN_FIELD].push_back(child)
		# set current name to be the next node at the back of the stack now
		currentNodeName = nodeStack.back()[NODE_FIELD]
	
	# presets save common attributes for nodes including children, will save all unless 
	# whitelisted attributes/children are specified in PRESET_RULES
	var presets: = {}
	
	var nodeError = parser.read() 
	while nodeError != ERR_FILE_EOF:
		if nodeError != OK:
			printerr("error with data, %s" % error_string(nodeError)) 
			return {}
		
		# opening tag found
		if parser.get_node_type() == XMLParser.NODE_ELEMENT:
			var node: Dictionary = getAttributes(parser)
			currentNodeName = node[NODE_FIELD]
			# this tag closes itself, we know it has no children
			if parser.is_empty():
				# edge case file is only one node
				if nodeStack.is_empty():
					return node
				_mergeChildInStack.call(node)
				currentNodeName = nodeStack.back()[NODE_FIELD]
			else:
				nodeStack.push_back(node)
		
		# closing tag found
		if parser.get_node_type() == XMLParser.NODE_ELEMENT_END:
			var nodeName: String = parser.get_node_name()
			
			if nodeName != currentNodeName:
				printerr("</%s> closing tag not found, </%s> found instead.\nLine %s: (%s)" % [
					currentNodeName, nodeName, parser.get_current_line()+1,
					fileLines[parser.get_current_line()]
				]) 
				return {}
			
			var poppedNode = nodeStack.pop_back()
			if nodeStack.is_empty():
				if !poppedNode:
					printerr("ending tag found before opening tag.\nLine %s: (%s)" % [
						parser.get_current_line()+1,
						fileLines[parser.get_current_line()]
					])
					return {}
				root = poppedNode
				break
			
			# apply preset to node
			if poppedNode.has(PRESET_FIELD):
				setPreset(poppedNode, presets)
			
			_mergeChildInStack.call(poppedNode)
			currentNodeName = nodeStack.back()[NODE_FIELD]
		
		# read next node in xml
		nodeError = parser.read()
	
	return root

## Given dictionary/node that has preset field, if the preset does not yet exist it's attributes and children will be saved as a preset according to the PRESET_RULES
func setPreset(node: Dictionary, existingPresets: Dictionary):
	# if node has a preset label in existingPresets, append in data 
	if existingPresets.has(node[PRESET_FIELD]):
		# push preset attributes into node
		var nodePreset = existingPresets[node[PRESET_FIELD]]
		for key in nodePreset.keys():
			# children will be handled later, don't overwrite current children
			if key != CHILDREN_FIELD:
				node[key] = nodePreset[key]
		# push preset children into node
		if nodePreset.has(CHILDREN_FIELD):
			# create 'children' field if it doesn't exist
			if not node.has(CHILDREN_FIELD):
				node[CHILDREN_FIELD] = []
			node[CHILDREN_FIELD].append_array(nodePreset[CHILDREN_FIELD])
		return
	
	# if node has a preset label that doesn't exist yet, create the preset for later nodes
	var presetAttributes := {}
	# the preset has rules but hasn't been filled out yet
	if PRESET_RULES.has(node[NODE_FIELD]):
		# only save attributes mentioned in PRESET_RULES
		for attrName in PRESET_RULES[node[NODE_FIELD]].attributes:
			presetAttributes[attrName] = node[attrName]
		# save children to preset
		if node.has("children"):
			presetAttributes.children = []
			for child in node.children:
				# only save children with node names in PRESET_RULES
				if child[NODE_FIELD] in PRESET_RULES[node[NODE_FIELD]].children: 
					presetAttributes.children.push_back(child)
	# the preset has no roles, copy everything about the node
	else:
		presetAttributes = node
	existingPresets[node[PRESET_FIELD]] = presetAttributes
