extends Node

class_name XMLData

#@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

# will be used for debugging purposes
enum NodeType {NODE_NONE, NODE_ELEMENT, NODE_ELEMENT_END, NODE_TEXT, 
NODE_COMMENT, NODE_CDATA, NODE_UNKNOWN}
func getNodeTypeName(nodeType: int):
	return NodeType.keys()[nodeType]

const ATTR_LINE_MAX := 80
const NODE_FIELD := "node_name"
const CHILDREN_FIELD := "children"

# see [Preset] class lower in the file
var presets := {}
# first array of a preset rule is the whitelisted attributes to be copied, second is the child tag names to be copied
var presetRules := {
	"connection": [
		["type"],
		["vessel"],
	]
}

## Get all attributes out of an XML element, could be NODE_ELEMENT or NODE_TEXT
func _getAttributes(parser: XMLParser) -> Dictionary:
	var output := {}
	for i in parser.get_attribute_count():
		output[parser.get_attribute_name(i)] = parser.get_attribute_value(i)
	output[NODE_FIELD] = parser.get_node_name()
	return output

## Save JSON data as an xml document
func saveToFile(data: Dictionary, filePath: String):
	# TODO take input param
	var output := "<!-- %s -->\n" % "Human Male Body Structure"
	
	if not data.has(NODE_FIELD):
		printerr("'%s' not found in data" % NODE_FIELD)
		return
	
	output += _parseData(data)
	
	if output != "":
		var file = FileAccess.open(filePath, FileAccess.WRITE)
		file.store_string(output)
		file.close()
		print("file successfully saved at %s" % filePath)

## Recursive helper function to compute xml file output of a Dictionary
func _parseData(data: Dictionary, indent: String = "")->String:
	var output := ""
	
	if not data.has(NODE_FIELD):
		printerr("'%s' not found in data" % NODE_FIELD)
		return ""
	
	output += "<%s" % data[NODE_FIELD]
	var nodeAttributes = data.keys()
	var nodeAttrTexts: Array = []
	# erase XML meta information
	nodeAttributes.erase(NODE_FIELD)
	nodeAttributes.erase(CHILDREN_FIELD)
	for attrName in nodeAttributes:
		nodeAttrTexts.push_back("%s=\"%s\"" % [attrName, data[attrName]])
	
	# index is -1 so when while loop ends the index is correct, scoped higher to be used later
	var presetIndex := -1
	var presetFound := false
	# find if preset rules exist for this Dictionary, if so then a preset should be generated
	if presetRules.has(data[NODE_FIELD]):
		var nodePresetRules: Array = presetRules[data[NODE_FIELD]]
		# find if a preset exists with these attributes
		if presets.has(data[NODE_FIELD]):
			var potentialPresetNames: Array = presets[data[NODE_FIELD]].keys()
			# presetIndex and presetFound scoped higher to be used when saving attributes to string
			while not presetFound and presetIndex < potentialPresetNames.size() - 1:
				presetIndex += 1 
				var potentialPresetName: String = potentialPresetNames[presetIndex]
				var potentialPreset: Dictionary = presets[data[NODE_FIELD]][potentialPresetName]
				
				# determine what attributes a preset of this node contains
				var attrsForPreset := {}
				for attrName in nodePresetRules[0]:
					if data.has(attrName):
						attrsForPreset[attrName] = data[attrName]
				if data.has(CHILDREN_FIELD):
					for child in data[CHILDREN_FIELD]:
						if child[NODE_FIELD] in nodePresetRules[1]:
							if not attrsForPreset.has("children"):
								attrsForPreset.children = []
							attrsForPreset.children.push_back(child.duplicate())
				# TODO needs testing
				if nodePresetRules[0].is_empty() && nodePresetRules[0].is_empty():
					attrsForPreset = data
				
				# check if the potential preset matches this node's presettable attributes
				if JSON.stringify(potentialPreset) == JSON.stringify(attrsForPreset):
					presetFound = true
					# add preset attribute to save to file
					nodeAttrTexts.push_front("%s=\"%s\"" % ["preset", potentialPresetName])
					# set the string attributes array to only include non preset information
					nodeAttrTexts = nodeAttrTexts.filter(
						func(attributeText: String):
							# only if the attribute before the = isn't covered in the preset
							return not attributeText.substr(0, attributeText.find("=")) \
									in potentialPreset.keys()
					)
				
				# check next preset already created
		
		# if no existing presets match this node's attributes/children, make a new one!
		if not presetFound:
			# create preset Dictionary for this node name/type
			if not presets.has(data[NODE_FIELD]):
				presets[data[NODE_FIELD]] = {}
			# create preset with new name
			var newPresetName: String = "preset_%s" % presets[data[NODE_FIELD]].keys().size()
			presets[data[NODE_FIELD]][newPresetName] = {}
			var newPreset: Dictionary = presets[data[NODE_FIELD]][newPresetName]
			# add preset attribute to save to file
			nodeAttrTexts.push_front("%s=\"%s\"" % ["preset", newPresetName])
			
			if nodePresetRules.has("attributes"):
				for attrName in nodePresetRules[0]:
					if data.has(attrName):
						newPreset[attrName] = data[attrName]
			if nodePresetRules.has("children") and data.has(CHILDREN_FIELD):
				for child in data[CHILDREN_FIELD]:
					if child[NODE_FIELD] in nodePresetRules[1]:
						if not newPreset.has("children"):
							newPreset.children = []
						newPreset.children.push_back(child.duplicate())
	
	# determine how to diplay attributes
	# get the width of all of the attributes on one line
	var lengthOfAllAttr: int = nodeAttrTexts.reduce(
		func(totalLength: int, attributeText: String):
			# add 'attr="value"' length plus space
			totalLength += attributeText.length() + 1
			return totalLength
	# add opening/closing signs and node name to calculation 
	, ["<%s >" % data[NODE_FIELD]][0].length())
	
	# display attributes on multiple lines, or one if short enough.
	if lengthOfAllAttr > ATTR_LINE_MAX:
		output += "\n"
		for text in nodeAttrTexts:
			output+="%s	%s\n" % [indent, text]
	else:
		for text in nodeAttrTexts:
			output += " %s" % text
	
	# display children if node has them
	if data.has("children"):
		# close attributes, with indent if they're too long
		output += "%s>\n" % indent if lengthOfAllAttr > ATTR_LINE_MAX else ">\n"
		
		# filter the children to not include children in preset, if no preset if found or this is 
		# the first instance of this preset don't filter anything
		if presetFound:
			data.children = data.children.filter(
				func(child): return not child[NODE_FIELD] \
						in presetRules[data[NODE_FIELD]][1]
			)
		
		# apply indent for each child, then an extra one as it goes one level deeper.
		for child in data.children: 
			output += "%s	%s" % [indent, _parseData(child, indent+"	")]
		
		output += "%s</%s>\n" % [indent, data[NODE_FIELD]]
	else:
		# close attributes, and if node is empty we can end it here
		output += "%s/>\n" % [indent if lengthOfAllAttr > ATTR_LINE_MAX else ""]
	
	return output

## Read XML file and create a dictionary representing body data 
func readFile(filepath: String)-> Dictionary: # return custom error probably
	var file = FileAccess.open(filepath, FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open(filepath)
	if error != OK:
		printerr("error with opening file, %s" % error_string(error))
		return {}
	
	var nodeStack: Array[Dictionary] = []
	
	## if current open node doesn't have 'children' attribute yet, create one then add child
	var _mergeChildInStack = func(child: Dictionary):
		if not nodeStack.back().has(CHILDREN_FIELD):
			nodeStack.back()[CHILDREN_FIELD] = []
		nodeStack.back()[CHILDREN_FIELD].push_back(child)
	
	# TODO presets save common attributes for nodes including children, will save all unless 
	# whitelisted attributes/children are specified in PRESET_RULES
#	var objectPresets: = {} needs to be global for this class
	
	var nodeError = parser.read() 
	while nodeError != ERR_FILE_EOF:
		# TEST
		var nodeInfo = getAllNodeInfo(parser)
		
		if nodeError != OK:
			printerr("error with data, %s" % error_string(nodeError)) 
			return {}
		
		# opening tag found
		if parser.get_node_type() == XMLParser.NODE_ELEMENT:
			var node: Dictionary = _getAttributes(parser)
			# this tag closes itself, we know it has no children
			if parser.is_empty():
				# edge case file is only one node
				if nodeStack.is_empty():
					return node
				_mergeChildInStack.call(node)
			else:
				nodeStack.push_back(node)
		
		# closing tag found
		elif parser.get_node_type() == XMLParser.NODE_ELEMENT_END:
			var nodeName: String = parser.get_node_name()
			
			if nodeName != nodeStack.back()[NODE_FIELD]:
				printerr("</%s> closing tag not found, </%s> found instead.\nLine %s: (%s)" % [
					nodeStack.back()[NODE_FIELD], nodeName, parser.get_current_line()+1,
					fileLines[parser.get_current_line()]
				]) 
				return {}
			
			var poppedNode: Dictionary = nodeStack.pop_back()
			if !poppedNode:
				printerr("ending tag found before opening tag.\nLine %s: (%s)" % [
					parser.get_current_line()+1,
					fileLines[parser.get_current_line()]
				])
				return {}
			
			# apply preset to node
			#if poppedNode.has(Preset.PRESET_FIELD):
				#setPreset(poppedNode, presets)
			
			# if stack now empty, assume document is done
			if nodeStack.is_empty():
				return poppedNode
			
			# if stack not empty, make this node a child of the current open node
			_mergeChildInStack.call(poppedNode)
		
		# read next node in xml
		nodeError = parser.read()
	
	printerr("alreadsy at EOF, %s" % error_string(nodeError)) 
	return {}

## Given dictionary/node that has preset field, if the preset does not yet exist it's attributes and children will be saved as a preset according to the PRESET_RULES
func setPreset(node:  Dictionary, existingPresets: Dictionary):
	# if node has a preset label in existingPresets, append in data 
	if existingPresets.has(node["preset"]):
		# push preset attributes into node
		var nodePreset = existingPresets[node["preset"]]
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
	if presetRules.has(node[NODE_FIELD]):
		# only save attributes mentioned in PRESET_RULES
		for attrName in presetRules[node[NODE_FIELD]].attributes:
			presetAttributes[attrName] = node[attrName]
		# save children to preset
		if node.has("children"):
			presetAttributes.children = []
			for child in node.children:
				# only save children with node names in PRESET_RULES
				if child[NODE_FIELD] in presetRules[node[NODE_FIELD]].children: 
					presetAttributes.children.push_back(child)
	# the preset has no rules, copy everything about the node
	else:
		presetAttributes = node
	existingPresets[node["preset"]] = presetAttributes

func getAllNodeInfo(parser: XMLParser)->Dictionary:
	var output = {}
	var nodeType = parser.get_node_type()
	
	if nodeType == XMLParser.NODE_ELEMENT \
			|| nodeType == XMLParser.NODE_ELEMENT_END \
			|| nodeType == XMLParser.NODE_COMMENT \
			|| nodeType == XMLParser.NODE_CDATA:
		output.name = parser.get_node_name()
	
	output.node_type = getNodeTypeName(nodeType)
	output.is_empty = parser.is_empty()
	output.attributes = _getAttributes(parser)
	output.line_num = parser.get_current_line()+1
	output.file_offset = parser.get_node_offset()
	
	if nodeType == XMLParser.NODE_TEXT:
		output.text = parser.get_node_data()
	
	return output
