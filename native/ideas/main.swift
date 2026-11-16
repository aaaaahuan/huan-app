import Foundation
struct Input: Decodable { let requestID: String?; let text: String? }
struct Output: Encodable { let ok: Bool; let snapshot: IdeaSnapshot?; let message: String? }
let output: Output
do {
    guard CommandLine.arguments.count == 3 else { throw IdeaTable.error("缺少灵感路径。") }
    let data=FileHandle.standardInput.readDataToEndOfFile()
    let input=try JSONDecoder().decode(Input.self,from:data)
    let snapshot=try IdeaTable.perform(directory:URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true),receiptsURL:URL(fileURLWithPath:CommandLine.arguments[2]),requestID:input.requestID,text:input.text)
    output=Output(ok:true,snapshot:snapshot,message:nil)
} catch { output=Output(ok:false,snapshot:nil,message:error.localizedDescription) }
if let data=try? JSONEncoder().encode(output) { FileHandle.standardOutput.write(data) }
