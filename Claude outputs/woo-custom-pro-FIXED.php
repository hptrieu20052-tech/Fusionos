<?php
/**
 * Plugin Name: Woo Custom Pro
 * Plugin URI: https://theyourlist.com
 * Description: Custom WooCommerce Extension - Compatible with WP 7.1+ and WC 11.1+ (HPOS & Blocks ready)
 * Author: Ryan
 * Version: 2.1.1
 * Author URI: https://theyourlist.com
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 * WC tested up to: 11.1.0
 *
 * FUSION fix 10/2026 (v2.1.1): wcp_get_product_variants_data khop CHINH XAC ten style —
 * strpos cu lam type ten ngan ("Ornament") lot vao listing chi chon type ten dai hon
 * ("One Side (Acrylic Ornament)") cua seller khac.
 */

defined( 'ABSPATH' ) || exit;

// Declare HPOS (High-Performance Order Storage) and Cart/Checkout Blocks compatibility
add_action( 'before_woocommerce_init', function() {
    if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
    }
} );

/**
 * Rename Simple Product display name to Tshirt Product in WooCommerce
 */
add_filter( 'product_type_selector', 'wcp_rename_simple_product_type', 20, 1 );
function wcp_rename_simple_product_type( $types ) {
    if ( isset( $types['simple'] ) ) {
        $types['simple'] = __( 'Tshirt Product', 'woo-custom-pro' );
    }
    return $types;
}

/**
 * Helper: Get all available styles data directly from data/products.json
 */
function wcp_get_all_available_styles_data() {
    $json_file = plugin_dir_path( __FILE__ ) . 'data/products.json';
    if ( ! file_exists( $json_file ) ) {
        $json_file = WP_CONTENT_DIR . '/plugins/woo-custom-pro/data/products.json';
    }

    if ( file_exists( $json_file ) ) {
        $content = file_get_contents( $json_file );
        $decoded = json_decode( $content, true );
        if ( is_array( $decoded ) ) {
            return $decoded;
        }
    }

    return array();
}

/**
 * Helper: Get selected styles array for a specific product ID from meta
 */
function wcp_get_product_selected_styles( $product_id ) {
    if ( ! $product_id ) {
        return array();
    }
    $styles = get_post_meta( $product_id, '_wcp_selected_styles', true );
    if ( is_array( $styles ) ) {
        return array_values( array_filter( array_map( 'trim', $styles ) ) );
    } elseif ( is_string( $styles ) && ! empty( $styles ) ) {
        return array_values( array_filter( array_map( 'trim', explode( ',', $styles ) ) ) );
    }
    return array();
}

/**
 * Helper: Get product variants data filtered by product's assigned styles if configured
 */
function wcp_get_product_variants_data( $product_id = 0 ) {
    if ( ! $product_id ) {
        $product_id = get_the_ID();
    }

    $all_styles = wcp_get_all_available_styles_data();
    if ( empty( $all_styles ) ) {
        return array();
    }

    // Filter by product's selected styles if set
    if ( $product_id > 0 ) {
        $selected_styles = wcp_get_product_selected_styles( $product_id );
        if ( ! empty( $selected_styles ) ) {
            $filtered = array();
            $normalized_selected = array_map( function( $s ) {
                return strtolower( trim( (string) $s ) );
            }, $selected_styles );

            foreach ( $all_styles as $item ) {
                $item_style = isset( $item['styles'] ) ? strtolower( trim( (string) $item['styles'] ) ) : '';
                if ( empty( $item_style ) ) {
                    continue;
                }

                // FUSION fix 10/2026: chi khop CHINH XAC ten style.
                // strpos cu lam type ten ngan ("Ornament") lot vao listing chi chon
                // type ten dai hon ("One Side (Acrylic Ornament)") cua seller khac.
                $match = in_array( $item_style, $normalized_selected, true );

                if ( $match ) {
                    $filtered[] = $item;
                }
            }

            if ( ! empty( $filtered ) ) {
                return $filtered;
            }
        }
    }

    return $all_styles;
}

/**
 * Register Meta Box for Product Styles selection in Product Edit Screen (wp-admin/post.php)
 */
add_action( 'add_meta_boxes', 'wcp_add_product_styles_meta_box' );
function wcp_add_product_styles_meta_box() {
    add_meta_box(
        'wcp_product_styles_metabox',
        __( '👕 Product Styles / Kiểu Dáng Áo (Woo Custom Pro)', 'woo-custom-pro' ),
        'wcp_render_product_styles_metabox',
        'product',
        'normal',
        'high'
    );
}

function wcp_render_product_styles_metabox( $post ) {
    wp_nonce_field( 'wcp_save_product_styles_action', 'wcp_product_styles_nonce' );
    echo '<input type="hidden" name="wcp_styles_submitted" value="1">';

    $all_styles_data = wcp_get_all_available_styles_data();
    $selected_styles = wcp_get_product_selected_styles( $post->ID );
    $has_custom_selection = ! empty( $selected_styles );

    ?>
    <div class="wcp-styles-meta-wrap" style="padding: 10px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #e5e5e5;">
            <div>
                <span style="font-size:13px; color:#50575e;">
                    <?php esc_html_e( 'Chọn các kiểu dáng / mẫu áo (Styles) hiển thị cho sản phẩm này. Nếu không chọn kiểu nào, sản phẩm sẽ tự động load tất cả styles có trong data/products.json.', 'woo-custom-pro' ); ?>
                </span>
            </div>
            <div style="display:flex; gap:8px;">
                <button type="button" class="button button-small" onclick="wcpSelectAllStyles(true)">
                    ✓ <?php esc_html_e( 'Chọn tất cả (Select All)', 'woo-custom-pro' ); ?>
                </button>
                <button type="button" class="button button-small" onclick="wcpSelectAllStyles(false)">
                    ✗ <?php esc_html_e( 'Bỏ chọn tất cả (Clear All)', 'woo-custom-pro' ); ?>
                </button>
            </div>
        </div>

        <div class="wcp-style-tags-container" style="display:flex; flex-wrap:wrap; gap:10px; align-items:stretch;">
            <?php foreach ( $all_styles_data as $style_item ) :
                $style_name = isset( $style_item['styles'] ) ? $style_item['styles'] : '';
                if ( empty( $style_name ) ) continue;

                $style_img = isset( $style_item['image'] ) ? $style_item['image'] : '';
                $sizes_count = isset( $style_item['sizes'] ) && is_array( $style_item['sizes'] ) ? count( $style_item['sizes'] ) : 0;
                $colors_count = isset( $style_item['colors'] ) && is_array( $style_item['colors'] ) ? count( $style_item['colors'] ) : 0;

                // Check if currently selected
                $is_checked = false;
                if ( $has_custom_selection ) {
                    foreach ( $selected_styles as $sel ) {
                        if ( strtolower( trim( $sel ) ) === strtolower( trim( $style_name ) ) ) {
                            $is_checked = true;
                            break;
                        }
                    }
                }
            ?>
                <label class="wcp-style-tag-card <?php echo $is_checked ? 'active' : ''; ?>" style="display:inline-flex; align-items:center; gap:8px; padding:7px 14px; border:2px solid <?php echo $is_checked ? '#2271b1' : '#dcdcde'; ?>; background:<?php echo $is_checked ? '#f0f6fc' : '#ffffff'; ?>; border-radius:24px; cursor:pointer; user-select:none; transition:all .2s ease; box-shadow:0 1px 3px rgba(0,0,0,.04);">
                    <input type="checkbox" name="wcp_selected_styles[]" value="<?php echo esc_attr( $style_name ); ?>" <?php checked( $is_checked, true ); ?> style="display:none;" onchange="wcpToggleTagCard(this)">

                    <span class="wcp-tag-status-icon" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:<?php echo $is_checked ? '#2271b1' : '#f0f0f1'; ?>; color:<?php echo $is_checked ? '#ffffff' : '#646970'; ?>; font-size:11px; font-weight:bold;">
                        <?php echo $is_checked ? '✓' : '+'; ?>
                    </span>

                    <?php if ( ! empty( $style_img ) ) : ?>
                        <img src="<?php echo esc_url( $style_img ); ?>" alt="" style="width:22px; height:22px; object-fit:contain; border-radius:3px;">
                    <?php endif; ?>

                    <span style="font-weight:600; font-size:13px; color:<?php echo $is_checked ? '#1d2327' : '#2c3338'; ?>;">
                        <?php echo esc_html( $style_name ); ?>
                    </span>

                    <span style="font-size:11px; color:#646970; background:#e8e8e8; padding:1px 6px; border-radius:10px;">
                        <?php echo esc_html( $sizes_count . ' sizes / ' . $colors_count . ' colors' ); ?>
                    </span>
                </label>
            <?php endforeach; ?>
        </div>

        <div style="margin-top:12px; font-size:12px; color:#646970;">
            📊 <strong>Trạng thái:</strong> <span id="wcp_selected_count" style="font-weight:700; color:#2271b1;"><?php echo count( $selected_styles ); ?></span> / <?php echo count( $all_styles_data ); ?> styles được chọn.
            <?php if ( empty( $selected_styles ) ) : ?>
                <em style="color:#d63638; margin-left:6px;">(Đang để trống = tự động hiển thị tất cả styles trên trang mua hàng)</em>
            <?php endif; ?>
        </div>
    </div>

    <script>
        function wcpToggleTagCard(checkbox) {
            var card = checkbox.closest('.wcp-style-tag-card');
            var icon = card.querySelector('.wcp-tag-status-icon');
            if (checkbox.checked) {
                card.classList.add('active');
                card.style.borderColor = '#2271b1';
                card.style.background = '#f0f6fc';
                if (icon) {
                    icon.style.background = '#2271b1';
                    icon.style.color = '#ffffff';
                    icon.innerText = '✓';
                }
            } else {
                card.classList.remove('active');
                card.style.borderColor = '#dcdcde';
                card.style.background = '#ffffff';
                if (icon) {
                    icon.style.background = '#f0f0f1';
                    icon.style.color = '#646970';
                    icon.innerText = '+';
                }
            }
            wcpUpdateSelectedCount();
        }

        function wcpSelectAllStyles(checkAll) {
            var checkboxes = document.querySelectorAll('.wcp-style-tag-card input[type="checkbox"]');
            checkboxes.forEach(function(cb) {
                cb.checked = checkAll;
                wcpToggleTagCard(cb);
            });
        }

        function wcpUpdateSelectedCount() {
            var checked = document.querySelectorAll('.wcp-style-tag-card input[type="checkbox"]:checked').length;
            var countEl = document.getElementById('wcp_selected_count');
            if (countEl) countEl.innerText = checked;
        }
    </script>
    <?php
}

/**
 * Save selected styles meta from Product Edit Screen
 */
add_action( 'save_post_product', 'wcp_save_product_styles_meta', 20, 2 );
add_action( 'woocommerce_process_product_meta', 'wcp_save_product_styles_meta', 20, 1 );
function wcp_save_product_styles_meta( $post_id, $post = null ) {
    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }
    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }
    if ( ! isset( $_POST['wcp_product_styles_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['wcp_product_styles_nonce'] ) ), 'wcp_save_product_styles_action' ) ) {
        return;
    }

    if ( isset( $_POST['wcp_selected_styles'] ) && is_array( $_POST['wcp_selected_styles'] ) ) {
        $clean_styles = array();
        foreach ( $_POST['wcp_selected_styles'] as $st ) {
            $st_clean = sanitize_text_field( wp_unslash( $st ) );
            if ( ! empty( $st_clean ) && ! in_array( $st_clean, $clean_styles, true ) ) {
                $clean_styles[] = $st_clean;
            }
        }
        update_post_meta( $post_id, '_wcp_selected_styles', $clean_styles );
    } else {
        if ( isset( $_POST['wcp_styles_submitted'] ) ) {
            update_post_meta( $post_id, '_wcp_selected_styles', array() );
        }
    }
}

/**
 * Helper: Check if color name should be shown below color swatch
 */
function wcp_is_show_color_name() {
    return get_option( 'wcp_show_color_name', 'yes' ) === 'yes';
}

/**
 * Helper: Check if loop Add to Cart button should be shown on product list
 */
function wcp_is_show_loop_add_to_cart() {
    return get_option( 'wcp_show_loop_add_to_cart', 'yes' ) === 'yes';
}

/**
 * Helper: Get loop Add to Cart button text
 */
function wcp_get_loop_add_to_cart_text() {
    return get_option( 'wcp_loop_add_to_cart_text', 'ADD TO CART' );
}

/**
 * Helper: Get loop Add to Cart button background color
 */
function wcp_get_loop_add_to_cart_bg() {
    return get_option( 'wcp_loop_add_to_cart_bg', '#e62e5c' );
}

/**
 * Helper: Get loop Add to Cart button text color
 */
function wcp_get_loop_add_to_cart_color() {
    return get_option( 'wcp_loop_add_to_cart_color', '#ffffff' );
}

/**
 * Helper: Get checkout badge image URL
 */
function wcp_get_checkout_badge_image_url() {
    $default = '/wp-content/uploads/2022/04/Guaranteed-Safe-Checkout.png';
    return get_option( 'wcp_checkout_image_url', $default );
}

/**
 * Helper: Get discount percentage (default: 20%)
 */
function wcp_get_discount_percentage() {
    $pct = get_option( 'wcp_discount_percentage', '20' );
    return ( is_numeric( $pct ) && floatval( $pct ) >= 0 ) ? floatval( $pct ) : 20.0;
}

/**
 * Helper: Check if star ratings should be shown on product list / loop
 */
function wcp_is_show_loop_ratings() {
    return get_option( 'wcp_show_loop_ratings', 'yes' ) === 'yes';
}

/**
 * Helper: Check if star ratings & review count should be shown on single product page
 */
function wcp_is_show_single_ratings() {
    return get_option( 'wcp_show_single_ratings', 'yes' ) === 'yes';
}

/**
 * Helper: Get star rating color
 */
function wcp_get_star_rating_color() {
    $color = get_option( 'wcp_star_rating_color', '#f5a623' );
    return sanitize_hex_color( $color ) ? sanitize_hex_color( $color ) : '#f5a623';
}

/**
 * Helper: Deterministically generate product rating (4.8 - 5.0) and review count based on product ID
 */
function wcp_get_product_rating_data( $product_id = 0 ) {
    if ( ! $product_id ) {
        $product_id = get_the_ID();
    }
    if ( ! $product_id ) {
        return array(
            'rating'       => 5.0,
            'review_count' => 48,
            'stars_html'   => '★★★★★',
        );
    }

    $seed = abs( (int) crc32( 'wcp_seed_' . $product_id ) );

    $min_reviews = intval( get_option( 'wcp_min_review_count', 18 ) );
    $max_reviews = intval( get_option( 'wcp_max_review_count', 145 ) );
    if ( $min_reviews <= 0 ) $min_reviews = 18;
    if ( $max_reviews < $min_reviews ) $max_reviews = $min_reviews + 100;

    $review_range = ( $max_reviews - $min_reviews ) + 1;
    $review_count = $min_reviews + ( $seed % $review_range );

    $ratings_pool = array( 4.8, 4.9, 5.0, 4.9, 5.0, 4.8, 5.0, 4.9, 5.0 );
    $rating_idx = ( $seed >> 3 ) % count( $ratings_pool );
    $rating = $ratings_pool[ $rating_idx ];

    return array(
        'rating'       => $rating,
        'review_count' => $review_count,
        'stars_html'   => '★★★★★',
    );
}

/**
 * Helper: Calculate lowest style price from products.json and regular price (+20%) for a product
 */
function wcp_get_product_display_prices( $product_id = 0 ) {
    if ( ! $product_id ) {
        $product_id = get_the_ID();
    }

    $variants = wcp_get_product_variants_data( $product_id );
    $min_price = 0;

    if ( ! empty( $variants ) && is_array( $variants ) ) {
        $prices = array();
        foreach ( $variants as $var ) {
            if ( isset( $var['sizes'] ) && is_array( $var['sizes'] ) ) {
                foreach ( $var['sizes'] as $sz ) {
                    $parts = explode( '-', (string) $sz );
                    $price_str = end( $parts );
                    if ( is_numeric( $price_str ) && floatval( $price_str ) > 0 ) {
                        $prices[] = floatval( $price_str );
                    }
                }
            }
        }
        if ( ! empty( $prices ) ) {
            $min_price = min( $prices );
        }
    }

    if ( $min_price <= 0 && $product_id ) {
        $wc_prod = wc_get_product( $product_id );
        if ( $wc_prod ) {
            $wc_p = floatval( $wc_prod->get_price() );
            if ( $wc_p > 0 ) {
                $min_price = $wc_p;
            }
        }
    }

    if ( $min_price <= 0 ) {
        $min_price = 19.99;
    }

    $discount_pct = wcp_get_discount_percentage();
    $regular_price = round( $min_price * ( 1 + ( $discount_pct / 100 ) ), 2 );

    return array(
        'sale_price'       => $min_price,
        'regular_price'    => $regular_price,
        'discount_percent' => $discount_pct,
    );
}

// Include submodules
require_once plugin_dir_path( __FILE__ ) . 'custom-page-product-variants.php';
require_once plugin_dir_path( __FILE__ ) . 'custom-page-import-product.php';
require_once plugin_dir_path( __FILE__ ) . 'custom-api-product-ext.php';
require_once plugin_dir_path( __FILE__ ) . 'custom-personalize-product-ext.php';
require_once plugin_dir_path( __FILE__ ) . 'custom-product-related-ext.php';

/**
 * Locate custom single-product add-to-cart template (Applies ONLY to simple / Tshirt products)
 */
add_filter( 'woocommerce_locate_template', 'csp_locate_template', 10, 3 );
function csp_locate_template( $template, $template_name, $template_path ) {
    global $product;

    if ( $template_name === 'single-product/add-to-cart/simple.php' || basename( $template ) === 'simple.php' ) {
        // Ensure this only applies to simple product
        if ( is_a( $product, 'WC_Product' ) && ! $product->is_type( 'simple' ) ) {
            return $template;
        }

        $custom_template = plugin_dir_path( __FILE__ ) . 'template/woocommerce/templates/single-product/add-to-cart/simple.php';
        if ( file_exists( $custom_template ) ) {
            return $custom_template;
        }
    }
    return $template;
}

/**
 * Set custom cart item price dynamically (Applies only to simple products)
 */
add_action( 'woocommerce_before_calculate_totals', 'set_custom_cart_item_price', 20, 1 );
function set_custom_cart_item_price( $cart ) {
    if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
        return;
    }

    if ( did_action( 'woocommerce_before_calculate_totals' ) >= 2 ) {
        return;
    }

    foreach ( $cart->get_cart() as $cart_item ) {
        if ( isset( $cart_item['custom_price'] ) && isset( $cart_item['data'] ) && is_a( $cart_item['data'], 'WC_Product' ) ) {
            if ( $cart_item['data']->is_type( 'simple' ) ) {
                $cart_item['data']->set_price( floatval( $cart_item['custom_price'] ) );
            }
        }
    }
}

/**
 * Save custom product attributes and price to cart item data (Only for simple products)
 */
add_filter( 'woocommerce_add_cart_item_data', 'save_custom_product_data', 10, 3 );
function save_custom_product_data( $cart_item_data, $product_id, $variation_id = 0 ) {
    $product = wc_get_product( $product_id );
    if ( ! $product || ! $product->is_type( 'simple' ) ) {
        return $cart_item_data;
    }

    $has_custom = false;
    $data = array();

    if ( isset( $_REQUEST['custom_price'] ) && is_numeric( $_REQUEST['custom_price'] ) ) {
        $cart_item_data['custom_price'] = floatval( $_REQUEST['custom_price'] );
    }

    if ( ! empty( $_REQUEST['attribute_style'] ) ) {
        $style_val = sanitize_text_field( wp_unslash( $_REQUEST['attribute_style'] ) );
        $cart_item_data['custom_data']['attribute_style'] = $style_val;
        $data['attribute_style'] = $style_val;
        $has_custom = true;
    }

    if ( ! empty( $_REQUEST['attribute_size'] ) ) {
        $size_val = sanitize_text_field( wp_unslash( $_REQUEST['attribute_size'] ) );
        $cart_item_data['custom_data']['attribute_size'] = $size_val;
        $data['attribute_size'] = $size_val;
        $has_custom = true;
    }

    if ( ! empty( $_REQUEST['attribute_color'] ) ) {
        $color_val = sanitize_text_field( wp_unslash( $_REQUEST['attribute_color'] ) );
        $cart_item_data['custom_data']['attribute_color'] = $color_val;
        $data['attribute_color'] = $color_val;
        $has_custom = true;
    }

    if ( $has_custom ) {
        $cart_item_data['custom_data']['unique_key'] = md5( microtime() . wp_rand() );
        if ( function_exists( 'WC' ) && WC()->session ) {
            WC()->session->set( 'custom_variations', $data );
        }
    }

    return $cart_item_data;
}

/**
 * Display custom data in cart & checkout
 */
add_filter( 'woocommerce_get_item_data', 'customizing_cart_item_data', 10, 2 );
function customizing_cart_item_data( $cart_data, $cart_item ) {
    $custom_items = ! empty( $cart_data ) && is_array( $cart_data ) ? $cart_data : array();

    if ( ! empty( $cart_item['custom_data']['attribute_style'] ) ) {
        $custom_items[] = array(
            'key'   => __( 'Style', 'woo-custom-pro' ),
            'name'  => __( 'Style', 'woo-custom-pro' ),
            'value' => esc_html( $cart_item['custom_data']['attribute_style'] ),
        );
    }
    if ( ! empty( $cart_item['custom_data']['attribute_size'] ) ) {
        $custom_items[] = array(
            'key'   => __( 'Size', 'woo-custom-pro' ),
            'name'  => __( 'Size', 'woo-custom-pro' ),
            'value' => esc_html( $cart_item['custom_data']['attribute_size'] ),
        );
    }
    if ( ! empty( $cart_item['custom_data']['attribute_color'] ) ) {
        $custom_items[] = array(
            'key'   => __( 'Color', 'woo-custom-pro' ),
            'name'  => __( 'Color', 'woo-custom-pro' ),
            'value' => esc_html( $cart_item['custom_data']['attribute_color'] ),
        );
    }

    return $custom_items;
}

/**
 * Save custom data to order line items (HPOS & WC 11.x CRUD compatible)
 */
add_action( 'woocommerce_checkout_create_order_line_item', 'wcp_add_custom_data_to_order_items', 10, 4 );
function wcp_add_custom_data_to_order_items( $item, $cart_item_key, $values, $order ) {
    if ( isset( $values['custom_data'] ) && is_array( $values['custom_data'] ) ) {
        if ( ! empty( $values['custom_data']['attribute_style'] ) ) {
            $item->add_meta_data( __( 'Style', 'woo-custom-pro' ), sanitize_text_field( $values['custom_data']['attribute_style'] ), true );
        }
        if ( ! empty( $values['custom_data']['attribute_size'] ) ) {
            $item->add_meta_data( __( 'Size', 'woo-custom-pro' ), sanitize_text_field( $values['custom_data']['attribute_size'] ), true );
        }
        if ( ! empty( $values['custom_data']['attribute_color'] ) ) {
            $item->add_meta_data( __( 'Color', 'woo-custom-pro' ), sanitize_text_field( $values['custom_data']['attribute_color'] ), true );
        }
    }
}

/**
 * Open Graph Meta tags for single product
 */
add_action( 'wp_head', 'add_product_open_graph_meta_tags' );
function add_product_open_graph_meta_tags() {
    if ( function_exists( 'is_product' ) && is_product() ) {
        $product_id = get_the_ID();
        $product = wc_get_product( $product_id );
        if ( $product && $product->is_type( 'simple' ) ) {
            $image_id = $product->get_image_id();
            if ( $image_id ) {
                $image_url = wp_get_attachment_image_url( $image_id, 'full' );
                if ( $image_url ) {
                    echo '<meta property="og:image" content="' . esc_url( $image_url ) . '">' . "\n";
                }
            }
        }
    }
}

/**
 * Clean width and height attributes from cart thumbnail
 */
add_filter( 'woocommerce_cart_item_thumbnail', 'custom_remove_width_height_attributes_from_cart_thumbnail', 10, 3 );
function custom_remove_width_height_attributes_from_cart_thumbnail( $product_image, $cart_item, $cart_item_key ) {
    return preg_replace( '/(width|height)="[^"]*"/i', '', $product_image );
}

/**
 * Search posts by title only
 */
function __search_by_title_only( $search, $wp_query ) {
    if ( ! is_admin() && $wp_query->is_main_query() && $wp_query->is_search() ) {
        global $wpdb;
        $search_terms = $wp_query->get( 's' );
        if ( ! empty( $search_terms ) ) {
            $search = $wpdb->prepare(
                " AND {$wpdb->posts}.post_title LIKE %s ",
                '%' . $wpdb->esc_like( $search_terms ) . '%'
            );
        }
    }
    return $search;
}
add_filter( 'posts_search', '__search_by_title_only', 10, 2 );

/**
 * Filter WooCommerce price HTML to display strikethrough regular price (+20%) and lowest style sale price
 */
add_filter( 'woocommerce_get_price_html', 'wcp_custom_product_price_html', 20, 2 );
function wcp_custom_product_price_html( $price_html, $product ) {
    if ( ! $product || ( is_admin() && ! wp_doing_ajax() ) ) {
        return $price_html;
    }

    if ( is_a( $product, 'WC_Product' ) && ! $product->is_type( 'simple' ) ) {
        return $price_html;
    }

    $product_id = is_a( $product, 'WC_Product' ) ? $product->get_id() : get_the_ID();
    if ( ! $product_id ) {
        return $price_html;
    }

    $prices = wcp_get_product_display_prices( $product_id );
    if ( empty( $prices ) || ! isset( $prices['sale_price'] ) || $prices['sale_price'] <= 0 ) {
        return $price_html;
    }

    $regular_price_html = wc_price( $prices['regular_price'] );
    $sale_price_html    = wc_price( $prices['sale_price'] );

    return '<del aria-hidden="true" class="wcp-del-price">' . $regular_price_html . '</del> <ins class="wcp-ins-price">' . $sale_price_html . '</ins>';
}

/**
 * Render custom ADD TO CART button on product list / loop
 * When clicked, navigates directly to the product detail page.
 */
add_action( 'woocommerce_before_shop_loop_item_title', 'wcp_render_loop_add_to_cart_button', 1 );
function wcp_render_loop_add_to_cart_button() {
    if ( ! wcp_is_show_loop_add_to_cart() ) {
        return;
    }

    global $product;
    $product_id = 0;
    $permalink = '';
    $title = '';

    if ( is_a( $product, 'WC_Product' ) ) {
        $product_id = $product->get_id();
        $permalink = $product->get_permalink();
        $title = $product->get_name();
    } else {
        $product_id = get_the_ID();
        if ( $product_id ) {
            $permalink = get_permalink( $product_id );
            $title = get_the_title( $product_id );
        }
    }

    if ( empty( $permalink ) ) {
        return;
    }

    $btn_text = wcp_get_loop_add_to_cart_text();
    if ( empty( $btn_text ) ) {
        $btn_text = __( 'ADD TO CART', 'woo-custom-pro' );
    }

    ?>
    <div class="wcp-loop-button-wrapper">
        <a href="<?php echo esc_url( $permalink ); ?>" class="wcp-loop-add-to-cart-btn" aria-label="<?php echo esc_attr( $btn_text . ' - ' . $title ); ?>" onclick="window.location.href='<?php echo esc_url( $permalink ); ?>'; event.stopPropagation();">
            <?php echo esc_html( $btn_text ); ?>
        </a>
    </div>
    <?php
}

/**
 * Render 4-5 gold star rating on product list / loop cards
 */
add_action( 'woocommerce_after_shop_loop_item_title', 'wcp_render_loop_star_rating', 4 );
function wcp_render_loop_star_rating() {
    if ( ! wcp_is_show_loop_ratings() ) {
        return;
    }

    global $product;
    $product_id = is_a( $product, 'WC_Product' ) ? $product->get_id() : get_the_ID();
    if ( ! $product_id ) return;

    $rating_data = wcp_get_product_rating_data( $product_id );
    $star_color = wcp_get_star_rating_color();

    ?>
    <div class="wcp-loop-rating" title="<?php echo esc_attr( sprintf( __( 'Rated %s out of 5', 'woo-custom-pro' ), $rating_data['rating'] ) ); ?>" style="text-align: center; margin: 4px 0 6px 0; line-height: 1;">
        <span class="wcp-loop-stars" style="color: <?php echo esc_attr( $star_color ); ?>; font-size: 20px; letter-spacing: 2px;">
            <?php echo esc_html( $rating_data['stars_html'] ); ?>
        </span>
    </div>
    <?php
}

/**
 * Render 4-5 gold star rating with review count on public single product detail page
 */
add_action( 'woocommerce_single_product_summary', 'wcp_render_single_product_rating', 7 );
function wcp_render_single_product_rating() {
    if ( ! wcp_is_show_single_ratings() ) {
        return;
    }

    global $product;
    $product_id = is_a( $product, 'WC_Product' ) ? $product->get_id() : get_the_ID();
    if ( ! $product_id ) return;

    $rating_data = wcp_get_product_rating_data( $product_id );
    $star_color = wcp_get_star_rating_color();

    ?>
    <div class="wcp-single-rating-wrapper">
        <span class="wcp-single-stars" style="color: <?php echo esc_attr( $star_color ); ?>; font-size: 20px; letter-spacing: 2px;">
            <?php echo esc_html( $rating_data['stars_html'] ); ?>
        </span>
        <span class="wcp-single-rating-score">
            <?php echo number_format( $rating_data['rating'], 1 ); ?>
        </span>
        <span class="wcp-single-review-count">
            (<?php echo esc_html( sprintf( _n( '%s review', '%s reviews', $rating_data['review_count'], 'woo-custom-pro' ), number_format_i18n( $rating_data['review_count'] ) ) ); ?>)
        </span>
    </div>
    <?php
}

/**
 * Clean duplicate default ratings if custom single ratings are active
 */
add_action( 'wp_head', 'wcp_remove_default_ratings', 10 );
function wcp_remove_default_ratings() {
    if ( wcp_is_show_single_ratings() ) {
        remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_rating', 10 );
    }
}

/**
 * Output comprehensive frontend styling for loop buttons, ratings, and strikethrough prices
 */
add_action( 'wp_head', 'wcp_output_frontend_custom_styles', 99 );
function wcp_output_frontend_custom_styles() {
    $btn_bg = esc_attr( wcp_get_loop_add_to_cart_bg() );
    $btn_color = esc_attr( wcp_get_loop_add_to_cart_color() );
    $star_color = esc_attr( wcp_get_star_rating_color() );
    ?>
    <style id="wcp-frontend-custom-styles">
        /* Loop Add to Cart Button */
        .wcp-loop-button-wrapper {
            display: block;
            width: 100%;
            margin: 0 0 10px 0;
            padding: 0;
            box-sizing: border-box;
            position: relative;
            z-index: 5;
        }
        .wcp-loop-add-to-cart-btn {
            display: flex !important;
            align-items: center;
            justify-content: center;
            width: 100% !important;
            min-height: 38px;
            padding: 8px 14px;
            background-color: <?php echo $btn_bg; ?> !important;
            color: <?php echo $btn_color; ?> !important;
            font-size: 13px !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            text-align: center !important;
            text-decoration: none !important;
            border-radius: 6px !important;
            border: none !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            cursor: pointer;
            box-sizing: border-box !important;
            -webkit-user-select: none;
            user-select: none;
        }
        .wcp-loop-add-to-cart-btn:hover {
            opacity: 0.92;
            color: <?php echo $btn_color; ?> !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
            transform: translateY(-1px);
        }
        .wcp-loop-add-to-cart-btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        /* Flatsome product box integration */
        .product-small.box .box-text .wcp-loop-button-wrapper {
            margin-top: 2px;
            margin-bottom: 8px;
        }

        /* Loop Card: Center Rating and Price in Product Grid / Loop only */
        .product-small .price-wrapper,
        .product-small .box-text .price-wrapper,
        .product-small.box .box-text .price-wrapper {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            text-align: center !important;
            margin-top: 4px !important;
            margin-bottom: 4px !important;
            margin-left: auto !important;
            margin-right: auto !important;
        }

        /* Star Rating in Product Loop (Row 1 - Centered & 20px) */
        .wcp-loop-rating {
            display: block !important;
            width: 100% !important;
            margin: 2px 0 4px 0 !important;
            line-height: 1 !important;
            text-align: center !important;
            clear: both !important;
        }
        .wcp-loop-stars {
            color: <?php echo $star_color; ?>;
            font-size: 20px !important;
            letter-spacing: 2px !important;
            display: inline-block !important;
            vertical-align: middle !important;
            user-select: none;
        }

        /* Price in Product Loop (Row 2 - Centered below stars) */
        .product-small .box-text .price,
        .product-small .price-wrapper .price,
        .product-small.box .price {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            text-align: center !important;
            margin: 2px 0 0 0 !important;
            clear: both !important;
        }

        /* Single Product Price (Normal / Left Alignment) */
        .product-info .price-wrapper,
        .product-summary .price-wrapper,
        .summary .price-wrapper,
        .single-product .product-summary .price,
        .single-product .price.product-page-price,
        .single-product .price-wrapper {
            display: block !important;
            text-align: inherit !important;
            margin: 4px 0 10px 0 !important;
        }
        .single-product .price.product-page-price {
            display: inline-block !important;
        }

        /* Strikethrough Regular Price & Sale Price */
        .wcp-del-price,
        .price del.wcp-del-price,
        del.wcp-del-price,
        .price del {
            color: #92979b !important;
            font-size: 0.94em !important;
            font-weight: 400 !important;
            text-decoration: line-through !important;
            margin-right: 6px !important;
            display: inline-block !important;
            opacity: 0.85;
        }
        .wcp-ins-price,
        .price ins.wcp-ins-price,
        ins.wcp-ins-price,
        .price ins {
            color: #111111 !important;
            font-size: 1.05em !important;
            font-weight: 700 !important;
            text-decoration: none !important;
            display: inline-block !important;
        }

        /* Star Rating on Single Product Page (20px font-size) */
        .wcp-single-rating-wrapper {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 8px;
            margin: 4px 0 12px 0;
            flex-wrap: wrap;
            text-align: left !important;
        }
        .wcp-single-stars {
            color: <?php echo $star_color; ?>;
            font-size: 20px !important;
            letter-spacing: 2px !important;
            display: inline-block !important;
            line-height: 1 !important;
            user-select: none;
        }
        .wcp-single-rating-score {
            font-size: 15px !important;
            font-weight: 700 !important;
            color: #1d2327;
            line-height: 1;
        }
        .wcp-single-review-count {
            font-size: 13px !important;
            color: #50575e;
            font-weight: 500;
            line-height: 1;
        }
    </style>
    <?php
}
