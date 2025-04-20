import { callPopup, eventSource, event_types, saveSettingsDebounced, substituteParams } from '../../../script.js';
import { extension_settings, getContext, renderExtensionTemplate, renderExtensionTemplateAsync } from '../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../popup.js';
import { uuidv4, setInfoBlock, parseJsonFile } from '../../utils.js';
import { processTagsInText, analyzeTagsInText, validateTag, showTagInfo } from './engine.js';

// 初始化扩展设置
if (!extension_settings.tagfilter) {
    extension_settings.tagfilter = {
        tags: [],
        excludedPrompts: [],
        enabled: true,
        showContext: true
    };
}

/**
 * 加载标签列表到UI
 */
async function loadTags() {
    jQuery('#tag_container').empty();
    
    const tagTemplate = jQuery(await renderExtensionTemplateAsync('tagfilter', 'tagTemplate'));
    
    extension_settings.tagfilter.tags.forEach((tag, index) => {
        const tagHtml = tagTemplate.clone();
        tagHtml.attr('id', tag.id);
        tagHtml.find('.tag-preview').text(`${tag.openTag}...${tag.closeTag}`);
        tagHtml.find('.tag-label').text(tag.name);
        
        // 如果标签被禁用，添加样式
        if (tag.enabled === false) {
            tagHtml.addClass('disabled');
            tagHtml.find('.tag-label').css('text-decoration', 'line-through');
        }
        
        // 添加编辑和删除事件
        tagHtml.find('.edit_tag').on('click', function() {
            openTagEditor(tag.id);
        });
        
        tagHtml.find('.delete_tag').on('click', async function() {
            const confirm = await callGenericPopup('确定要删除这个标签吗？', POPUP_TYPE.CONFIRM);
            if (confirm) {
                extension_settings.tagfilter.tags = extension_settings.tagfilter.tags.filter(t => t.id !== tag.id);
                saveSettingsDebounced();
                await loadTags();
            }
        });
        
        jQuery('#tag_container').append(tagHtml);
    });
    
    // 更新测试模式的输出
    updateTestMode();
}

/**
 * 打开标签编辑器
 * @param {string} tagId 标签ID，如果为空则创建新标签
 */
async function openTagEditor(tagId) {
    const editorHtml = jQuery(await renderExtensionTemplateAsync('tagfilter', 'editor'));
    
    let existingTag = null;
    let existingTagIndex = -1;
    
    if (tagId) {
        existingTagIndex = extension_settings.tagfilter.tags.findIndex(tag => tag.id === tagId);
        if (existingTagIndex !== -1) {
            existingTag = extension_settings.tagfilter.tags[existingTagIndex];
            editorHtml.find('#tag_name').val(existingTag.name);
            editorHtml.find('#tag_open').val(existingTag.openTag);
            editorHtml.find('#tag_close').val(existingTag.closeTag);
            editorHtml.find('#tag_enabled').prop('checked', existingTag.enabled !== false);
        }
    }
    
    // 添加输入事件来更新信息块
    function updateInfoBlock() {
        const tag = {
            name: editorHtml.find('#tag_name').val(),
            openTag: editorHtml.find('#tag_open').val(),
            closeTag: editorHtml.find('#tag_close').val()
        };
        
        const validation = validateTag(tag);
        if (!validation.isValid) {
            setInfoBlock(editorHtml.find('#editor_info_block')[0], validation.message, 'error');
        } else {
            setInfoBlock(editorHtml.find('#editor_info_block')[0], '标签格式有效', 'hint');
        }
    }
    
    editorHtml.find('input').on('input', updateInfoBlock);
    updateInfoBlock();
    
    const result = await callPopup(editorHtml, 'confirm', undefined, { okButton: '保存' });
    if (result) {
        const newTag = {
            id: existingTag ? existingTag.id : uuidv4(),
            name: editorHtml.find('#tag_name').val(),
            openTag: editorHtml.find('#tag_open').val(),
            closeTag: editorHtml.find('#tag_close').val(),
            enabled: editorHtml.find('#tag_enabled').is(':checked')
        };
        
        const validation = validateTag(newTag);
        if (!validation.isValid) {
            console.error(`无法保存标签: ${validation.message}`);
            return;
        }
        
        if (existingTagIndex !== -1) {
            extension_settings.tagfilter.tags[existingTagIndex] = newTag;
        } else {
            extension_settings.tagfilter.tags.push(newTag);
        }
        
        saveSettingsDebounced();
        await loadTags();
    }
}

/**
 * 更新测试模式的输出
 */
function updateTestMode() {
    const testInput = jQuery('#test_input').val();
    if (!testInput) return;
    
    // 先显示输入文本
    jQuery('#test_output').val(testInput);
    
    // 然后应用标签过滤（移除标签内容）
    const filtered = processTagsInText(testInput, true);
    jQuery('#test_output').val(filtered);
}

/**
 * 扫描当前提示并显示结果
 */
async function scanCurrentPrompt() {
    try {
        const context = getContext();
        if (!context || !context.chatCompletion) {
            throw new Error('无法获取当前上下文');
        }
        
        // 获取原始提示
        const promptText = context.prompt || '';
        
        // 分段显示提示
        const promptParts = promptText.split('\n\n');
        const promptTemplate = jQuery(await renderExtensionTemplateAsync('tagfilter', 'promptTemplate'));
        
        jQuery('#prompt_list_container').empty();
        
        // 按顺序显示提示部分
        for (let i = 0; i < promptParts.length; i++) {
            const part = promptParts[i];
            
            if (!part.trim()) continue;
            
            const promptHtml = promptTemplate.clone();
            promptHtml.attr('data-index', i);
            
            // 检查此部分是否在排除列表中
            const isExcluded = extension_settings.tagfilter.excludedPrompts.includes(i);
            promptHtml.find('.prompt-checkbox').prop('checked', !isExcluded);
            
            // 设置文本和编辑区域
            promptHtml.find('.prompt-text').text(part.length > 100 ? part.substring(0, 100) + '...' : part);
            promptHtml.find('.prompt-edit-area').val(part);
            
            // 添加复选框更改事件
            promptHtml.find('.prompt-checkbox').on('change', function() {
                const isChecked = jQuery(this).is(':checked');
                const partIndex = parseInt(promptHtml.attr('data-index'));
                
                if (isChecked) {
                    // 从排除列表中移除
                    extension_settings.tagfilter.excludedPrompts = extension_settings.tagfilter.excludedPrompts.filter(idx => idx !== partIndex);
                } else {
                    // 添加到排除列表
                    if (!extension_settings.tagfilter.excludedPrompts.includes(partIndex)) {
                        extension_settings.tagfilter.excludedPrompts.push(partIndex);
                    }
                }
                
                saveSettingsDebounced();
            });
            
            // 添加编辑按钮事件
            promptHtml.find('.edit-prompt-btn').on('click', function() {
                const editArea = promptHtml.find('.prompt-edit-area');
                const textPreview = promptHtml.find('.prompt-text');
                
                if (editArea.is(':visible')) {
                    // 保存编辑并隐藏编辑区域
                    const newText = editArea.val();
                    const partIndex = parseInt(promptHtml.attr('data-index'));
                    
                    // 更新预览文本
                    textPreview.text(newText.length > 100 ? newText.substring(0, 100) + '...' : newText);
                    
                    // 更新提示文本（需要更新context中的提示）
                    const context = getContext();
                    if (context && context.prompt) {
                        const parts = context.prompt.split('\n\n');
                        parts[partIndex] = newText;
                        context.prompt = parts.join('\n\n');
                    }
                    
                    editArea.hide();
                    textPreview.show();
                    jQuery(this).find('i').removeClass('fa-save').addClass('fa-pencil');
                } else {
                    // 显示编辑区域
                    textPreview.hide();
                    editArea.show();
                    jQuery(this).find('i').removeClass('fa-pencil').addClass('fa-save');
                }
            });
            
            // 添加上移按钮事件
            promptHtml.find('.move-up-btn').on('click', function() {
                const partIndex = parseInt(promptHtml.attr('data-index'));
                if (partIndex > 0) {
                    // 获取上下文
                    const context = getContext();
                    if (context && context.prompt) {
                        const parts = context.prompt.split('\n\n');
                        
                        // 交换当前段落与上一段落
                        [parts[partIndex], parts[partIndex - 1]] = [parts[partIndex - 1], parts[partIndex]];
                        
                        // 更新上下文
                        context.prompt = parts.join('\n\n');
                        
                        // 重新扫描显示
                        scanCurrentPrompt();
                    }
                }
            });
            
            // 添加下移按钮事件
            promptHtml.find('.move-down-btn').on('click', function() {
                const partIndex = parseInt(promptHtml.attr('data-index'));
                
                // 获取上下文
                const context = getContext();
                if (context && context.prompt) {
                    const parts = context.prompt.split('\n\n');
                    
                    if (partIndex < parts.length - 1) {
                        // 交换当前段落与下一段落
                        [parts[partIndex], parts[partIndex + 1]] = [parts[partIndex + 1], parts[partIndex]];
                        
                        // 更新上下文
                        context.prompt = parts.join('\n\n');
                        
                        // 重新扫描显示
                        scanCurrentPrompt();
                    }
                }
            });
            
            jQuery('#prompt_list_container').append(promptHtml);
        }
        
        // 显示提示扫描区块
        jQuery('#prompt_scan_block').removeClass('displayNone');
    } catch (error) {
        console.error('扫描提示失败:', error);
        console.error('扫描提示失败: ' + error.message);
    }
}

/**
 * 处理生成前的提示
 * @param {object} data 提示数据
 */
function handlePromptGeneration(data) {
    if (!extension_settings.tagfilter.enabled || !extension_settings.tagfilter.tags.length) {
        return;
    }
    
    try {
        if (data.prompt) {
            // 显示原始提示到上下文查看器
            if (extension_settings.tagfilter.showContext && jQuery('#tagfilter_context_viewer').length) {
                jQuery('#context_original').val(data.prompt);
            }
            
            // 将提示分割为段落
            const promptParts = data.prompt.split('\n\n');
            
            // 处理每个段落，排除用户选择保留的部分
            const processedParts = promptParts.map((part, index) => {
                if (extension_settings.tagfilter.excludedPrompts.includes(index)) {
                    return part;
                }
                return processTagsInText(part, true);
            });
            
            // 重新组合提示
            data.prompt = processedParts.join('\n\n');
            
            // 显示处理后的提示到上下文查看器
            if (extension_settings.tagfilter.showContext && jQuery('#tagfilter_context_viewer').length) {
                jQuery('#context_processed').val(data.prompt);
            }
        }
    } catch (error) {
        console.error('处理提示失败:', error);
    }
}

/**
 * 创建上下文查看器
 */
function createContextViewer() {
    if (jQuery('#tagfilter_context_viewer').length) {
        return;
    }
    
    const viewerHtml = `
        <div id="tagfilter_context_viewer" class="tagfilter_context_viewer">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>提示上下文查看器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="display:none;">
                    <div class="context-tabs">
                        <div class="context-tab active" data-tab="original">原始提示</div>
                        <div class="context-tab" data-tab="processed">处理后提示</div>
                    </div>
                    <div class="context-content">
                        <textarea id="context_original" class="text_pole textarea_compact" rows="10" readonly></textarea>
                        <textarea id="context_processed" class="text_pole textarea_compact" rows="10" style="display:none;" readonly></textarea>
                    </div>
                    <div class="context-actions">
                        <button id="copy_context" class="menu_button">复制当前内容</button>
                        <button id="refresh_context" class="menu_button">刷新内容</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    jQuery('#send_form').after(viewerHtml);
    
    // 添加标签切换事件
    jQuery('.context-tab').on('click', function() {
        const tab = jQuery(this).data('tab');
        jQuery('.context-tab').removeClass('active');
        jQuery(this).addClass('active');
        
        if (tab === 'original') {
            jQuery('#context_original').show();
            jQuery('#context_processed').hide();
        } else {
            jQuery('#context_original').hide();
            jQuery('#context_processed').show();
        }
    });
    
    // 添加复制按钮事件
    jQuery('#copy_context').on('click', function() {
        const activeTab = jQuery('.context-tab.active').data('tab');
        const text = activeTab === 'original' ? jQuery('#context_original').val() : jQuery('#context_processed').val();
        
        navigator.clipboard.writeText(text).then(() => {
            console.log('已复制到剪贴板');
        }).catch(err => {
            console.error('复制失败: ', err);
        });
    });
    
    // 添加刷新按钮事件
    jQuery('#refresh_context').on('click', function() {
        scanCurrentPrompt();
    });
}

/**
 * 初始化上下文查看器
 */
function initContextViewer() {
    if (extension_settings.tagfilter.showContext) {
        createContextViewer();
    } else {
        jQuery('#tagfilter_context_viewer').remove();
    }
}

// 初始化扩展
jQuery(async () => {
    // 防止扩展被禁用时运行
    if (extension_settings.disabledExtensions.includes('tagfilter')) {
        return;
    }
    
    const settingsHtml = jQuery(await renderExtensionTemplateAsync('tagfilter', 'dropdown'));
    jQuery('#extensions_settings').append(settingsHtml);
    
    // 添加事件监听
    jQuery('#add_tag').on('click', function() {
        openTagEditor();
    });
    
    jQuery('#scan_prompt').on('click', function() {
        scanCurrentPrompt();
    });
    
    jQuery('#toggle_test_mode').on('click', function() {
        jQuery('#tagfilter_test_mode').toggleClass('displayNone');
    });
    
    jQuery('#test_input').on('input', function() {
        updateTestMode();
    });
    
    // 上下文查看器开关
    jQuery('#toggle_context_viewer').on('change', function() {
        const isChecked = jQuery(this).is(':checked');
        extension_settings.tagfilter.showContext = isChecked;
        saveSettingsDebounced();
        
        initContextViewer();
    });
    
    // 初始化上下文查看器开关状态
    jQuery('#toggle_context_viewer').prop('checked', extension_settings.tagfilter.showContext !== false);
    
    // 初始化上下文查看器
    initContextViewer();
    
    // 加载保存的标签
    await loadTags();
    
    // 添加事件监听以在生成前处理提示
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, handlePromptGeneration);
}); 